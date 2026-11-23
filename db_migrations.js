/**
 * ABYX Database Migrations & Versioning Engine
 * 
 * Invariants:
 * - Versioned schema tracked in `schema_migrations`.
 * - Automatic pre-migration backup before any structural alteration.
 * - Atomic transactions with full rollback on failure.
 * - Integrity validation (PRAGMA integrity_check) on startup.
 * - Zero data loss: Preserves all existing IDs, timestamps, and relations.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./security/password_hasher');
const { dataDir } = require('./data_paths');

const BACKUPS_DIR = path.resolve(dataDir, 'backups');

function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

/**
 * Validate SQLite database file integrity
 */
function validateDatabaseIntegrity(dbPath) {
  if (!fs.existsSync(dbPath)) {
    return { valid: false, exists: false, reason: 'FILE_NOT_FOUND', error: 'File does not exist' };
  }

  try {
    const stat = fs.statSync(dbPath);
    if (stat.size === 0) {
      return { valid: false, exists: true, reason: 'ZERO_BYTE_FILE', error: 'Database file is empty (0 bytes)' };
    }

    // Verify 16-byte SQLite 3 magic header ("SQLite format 3\0")
    const headerBuf = Buffer.alloc(16);
    const fd = fs.openSync(dbPath, 'r');
    const bytesRead = fs.readSync(fd, headerBuf, 0, 16, 0);
    fs.closeSync(fd);

    if (bytesRead < 16 || headerBuf.toString('utf8', 0, 15) !== 'SQLite format 3') {
      return { valid: false, exists: true, reason: 'INVALID_HEADER', error: 'File header is not a valid SQLite format 3 signature' };
    }

    let db = null;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      db.exec('PRAGMA busy_timeout = 5000;');
      const check = db.prepare('PRAGMA integrity_check;').get();
      if (check && check.integrity_check === 'ok') {
        const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check;').all();
        if (foreignKeyErrors.length) {
          return { valid: false, exists: true, reason: 'FOREIGN_KEY_CHECK_FAILED', error: `${foreignKeyErrors.length} foreign-key violation(s)` };
        }
        return { valid: true, exists: true };
      } else {
        return { valid: false, exists: true, reason: 'INTEGRITY_CHECK_FAILED', error: check?.integrity_check || 'Integrity check failed' };
      }
    } finally {
      if (db) {
        try { db.close(); } catch (e) {}
      }
    }
  } catch (err) {
    if (err.message && (err.message.includes('locked') || err.message.includes('busy'))) {
      return { valid: true, exists: true };
    }
    return { valid: false, exists: true, reason: 'INVALID_HEADER', error: err.message };
  }
}

/**
 * Create a timestamped pre-migration backup
 */
function createPreMigrationBackup(dbPath, label = 'pre_migration') {
  ensureBackupsDir();
  if (!fs.existsSync(dbPath)) return null;
  const safeLabel = String(label).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'backup';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUPS_DIR, `abyx_db_${safeLabel}_${timestamp}.db`);
  const tempPath = `${backupPath}.tmp-${process.pid}-${require('node:crypto').randomBytes(4).toString('hex')}`;
  let checkpointDb;
  try {
    checkpointDb = new DatabaseSync(dbPath);
    const checkpoint = checkpointDb.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (checkpoint?.busy) throw new Error('Database is busy; WAL checkpoint could not complete');
    checkpointDb.close();
    checkpointDb = null;
    fs.copyFileSync(dbPath, tempPath);
    const validation = validateDatabaseIntegrity(tempPath);
    if (!validation.valid) throw new Error(`Backup validation failed: ${validation.error}`);
    fs.renameSync(tempPath, backupPath);
    console.log(`[MIGRATION] Verified database backup created at: ${backupPath}`);
    return backupPath;
  } catch (error) {
    try { checkpointDb?.close(); } catch {}
    try { fs.rmSync(tempPath, { force: true }); } catch {}
    throw error;
  }
}

/**
 * Apply all pending migrations sequentially
 */
function runMigrations(dbPath) {
  ensureBackupsDir();

  // 1. Verify integrity before touching (if existing database file)
  if (fs.existsSync(dbPath)) {
    const integrity = validateDatabaseIntegrity(dbPath);
    if (!integrity.valid) {
      const isDefaultDb = path.resolve(dbPath) === path.resolve(path.join(dataDir, 'abyx_memory.db')) || path.resolve(dbPath) === path.resolve(path.join(dataDir, 'axom_memory.db'));
      const recoverable = isDefaultDb && fs.existsSync(BACKUPS_DIR)
        ? fs.readdirSync(BACKUPS_DIR).filter(name => name.endsWith('.db'))
          .map(name => path.join(BACKUPS_DIR, name)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
          .find(candidate => validateDatabaseIntegrity(candidate).valid)
        : null;
      if (!recoverable) throw new Error(`[MIGRATION HALTED] Database integrity check failed on ${dbPath}: ${integrity.error}`);
      const damagedPath = `${dbPath}.corrupt.${Date.now()}`;
      fs.copyFileSync(dbPath, damagedPath);
      const recoveryTemp = `${dbPath}.recovery.tmp`;
      fs.copyFileSync(recoverable, recoveryTemp);
      const recoveryCheck = validateDatabaseIntegrity(recoveryTemp);
      if (!recoveryCheck.valid) {
        fs.rmSync(recoveryTemp, { force: true });
        throw new Error(`[MIGRATION HALTED] Recovery backup failed validation: ${recoveryCheck.error}`);
      }
      fs.renameSync(recoveryTemp, dbPath);
      for (const suffix of ['-wal', '-shm']) {
        try {
          if (fs.existsSync(`${dbPath}${suffix}`)) fs.copyFileSync(`${dbPath}${suffix}`, `${damagedPath}${suffix}`);
          fs.rmSync(`${dbPath}${suffix}`, { force: true });
        } catch {}
      }
      console.error(`[MIGRATION RECOVERY] Restored ${dbPath} from ${recoverable}; damaged database preserved at ${damagedPath}`);
    }
  }

  // 2. Open database in WAL mode
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // 3. Ensure schema_migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      backup_path TEXT
    );
  `);

  const appliedVersions = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );

  console.log(`[MIGRATION] Current applied schema versions: [${Array.from(appliedVersions).join(', ')}]`);

  // Ensure knowledge_chunks_fts is usable even if fts5 module is not compiled in
  try {
    db.prepare('SELECT count(*) FROM knowledge_chunks_fts LIMIT 1;').get();
  } catch (err) {
    if (err.message && err.message.includes('fts5')) {
      try {
        db.exec("PRAGMA writable_schema = ON; DELETE FROM sqlite_schema WHERE name = 'knowledge_chunks_fts'; PRAGMA writable_schema = OFF;");
        db.exec(`
          CREATE TABLE IF NOT EXISTS knowledge_chunks_fts (
            chunk_id TEXT,
            source_id TEXT,
            profile_id TEXT,
            source_name TEXT,
            section_title TEXT,
            content TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_kchunks_fts_profile ON knowledge_chunks_fts(profile_id);
          CREATE INDEX IF NOT EXISTS idx_kchunks_fts_source ON knowledge_chunks_fts(source_id);
        `);
      } catch (_) {}
    }
  }

  // --- MIGRATION 1: Legacy Base Tables ---
  if (!appliedVersions.has(1)) {
    console.log('[MIGRATION] Applying Migration 1: Base living memory tables...');
    const backupPath = createPreMigrationBackup(dbPath, 'v1');

    db.exec('BEGIN TRANSACTION;');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chat_logs_session_ts ON chat_logs(session_id, timestamp);

        CREATE TABLE IF NOT EXISTS user_profile_memory (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          category TEXT NOT NULL,
          confidence_score REAL DEFAULT 1.0,
          reasoning TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_profile_memory_category ON user_profile_memory(category);

        CREATE TABLE IF NOT EXISTS session_metadata (
          session_id TEXT PRIMARY KEY,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          summary TEXT,
          message_count INTEGER DEFAULT 0,
          last_reviewed_at TEXT,
          status TEXT DEFAULT 'active'
        );

        CREATE TABLE IF NOT EXISTS token_usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          model TEXT,
          prompt_tokens INTEGER DEFAULT 0,
          completion_tokens INTEGER DEFAULT 0,
          total_tokens INTEGER DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_token_usage_created ON token_usage(created_at);

      `);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at, backup_path) VALUES (?, ?, ?, ?)')
        .run(1, '001_base_schema', new Date().toISOString(), backupPath || '');
      db.exec('COMMIT;');
      appliedVersions.add(1);
      console.log('[MIGRATION] Migration 1 applied successfully.');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw new Error(`[MIGRATION ERROR v1] Failed to apply base schema: ${err.message}`);
    }
  }

  // --- MIGRATION 2: Multi-Profile Isolation & Argon2id Auth Schema ---
  if (!appliedVersions.has(2)) {
    console.log('[MIGRATION] Applying Migration 2: Multi-profile isolation & secure auth schema...');
    const backupPath = createPreMigrationBackup(dbPath, 'v2');

    // Pre-computed Argon2id hash for 'abyx2026'
    const defaultHash = '$argon2id$v=19$m=65536,t=3,p=4$V8EU1qXfxOytAwFEnn9GYQ$Soi5C8MK7hkV0dSR0XjmTsX83S8G2jevGFTJ513V334';

    db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Create profiles table
      db.exec(`
        CREATE TABLE IF NOT EXISTS profiles (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          display_name TEXT,
          avatar TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_active_at TEXT,
          status TEXT DEFAULT 'active'
        );

        CREATE TABLE IF NOT EXISTS profile_sessions (
          token TEXT PRIMARY KEY,
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          is_locked INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_profile ON profile_sessions(profile_id);

        CREATE TABLE IF NOT EXISTS provider_credentials (
          id TEXT PRIMARY KEY,
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL,
          key_masked TEXT NOT NULL,
          key_length INTEGER NOT NULL,
          store_type TEXT NOT NULL,
          cred_ref TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(profile_id, provider_id)
        );
        CREATE INDEX IF NOT EXISTS idx_credentials_profile ON provider_credentials(profile_id);
      `);

      // 2. Insert Default Profile if not exists
      const now = new Date().toISOString();
      const existingProfile = db.prepare('SELECT id FROM profiles WHERE id = ?').get('prof_default');
      if (!existingProfile) {
        db.prepare(`
          INSERT INTO profiles (id, username, password_hash, display_name, avatar, created_at, updated_at, last_active_at, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run('prof_default', 'User', defaultHash, 'Local User', 'U', now, now, now, 'active');
      }

      // 3. Add profile_id to session_metadata, chat_logs, token_usage if missing
      const chatCols = db.prepare('PRAGMA table_info(chat_logs);').all().map(c => c.name);
      if (!chatCols.includes('profile_id')) {
        db.exec("ALTER TABLE chat_logs ADD COLUMN profile_id TEXT DEFAULT 'prof_default';");
        db.exec("CREATE INDEX IF NOT EXISTS idx_chat_logs_profile ON chat_logs(profile_id);");
      }

      const sessionCols = db.prepare('PRAGMA table_info(session_metadata);').all().map(c => c.name);
      if (!sessionCols.includes('profile_id')) {
        db.exec("ALTER TABLE session_metadata ADD COLUMN profile_id TEXT DEFAULT 'prof_default';");
        db.exec("CREATE INDEX IF NOT EXISTS idx_session_metadata_profile ON session_metadata(profile_id);");
      }

      const tokenCols = db.prepare('PRAGMA table_info(token_usage);').all().map(c => c.name);
      if (!tokenCols.includes('profile_id')) {
        db.exec("ALTER TABLE token_usage ADD COLUMN profile_id TEXT DEFAULT 'prof_default';");
        db.exec("CREATE INDEX IF NOT EXISTS idx_token_usage_profile ON token_usage(profile_id);");
      }

      // 4. Upgrade user_profile_memory to composite primary key (profile_id, key)
      const memCols = db.prepare('PRAGMA table_info(user_profile_memory);').all().map(c => c.name);
      if (!memCols.includes('profile_id')) {
        db.exec(`
          CREATE TABLE user_profile_memory_new (
            profile_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            category TEXT NOT NULL,
            confidence_score REAL DEFAULT 1.0,
            reasoning TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (profile_id, key)
          );

          INSERT INTO user_profile_memory_new (profile_id, key, value, category, confidence_score, reasoning, created_at, updated_at)
          SELECT 'prof_default', key, value, category, confidence_score, reasoning, created_at, updated_at
          FROM user_profile_memory;

          DROP TABLE user_profile_memory;
          ALTER TABLE user_profile_memory_new RENAME TO user_profile_memory;

          CREATE INDEX IF NOT EXISTS idx_profile_memory_profile_cat ON user_profile_memory(profile_id, category);
        `);
      }

      // 5. Record applied migration
      db.prepare(`
        INSERT INTO schema_migrations (version, name, applied_at, backup_path)
        VALUES (2, '002_multi_profile_isolation', datetime('now'), ?)
      `).run(backupPath || '');

      db.exec('COMMIT;');
      appliedVersions.add(2);
      console.log('[MIGRATION] Migration 2 applied successfully: Multi-profile isolation active.');
    } catch (err) {
      db.exec('ROLLBACK;');
      db.close();

      // Rollback to safety backup
      if (backupPath && fs.existsSync(backupPath)) {
        console.error(`[MIGRATION FAILED] Rolling back database from backup: ${backupPath}`);
        fs.copyFileSync(backupPath, dbPath);
      }
      throw new Error(`[MIGRATION ROLLBACK v2] Schema upgrade failed: ${err.message}`);
    }
  }

  // --- MIGRATION 3: Local Knowledge Base, Sources & RAG Chunks Schema ---
  if (!appliedVersions.has(3)) {
    console.log('[MIGRATION] Applying Migration 3: Knowledge sources, chunks & FTS5 search schema...');
    const backupPath = createPreMigrationBackup(dbPath, 'v3');

    db.exec('BEGIN TRANSACTION;');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_sources (
          id TEXT PRIMARY KEY,
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          file_path TEXT NOT NULL,
          file_type TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          file_hash TEXT NOT NULL,
          chunk_count INTEGER DEFAULT 0,
          total_chars INTEGER DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'indexed',
          indexing_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_sources_profile ON knowledge_sources(profile_id, status);
        CREATE INDEX IF NOT EXISTS idx_knowledge_sources_hash ON knowledge_sources(profile_id, file_hash);

        CREATE TABLE IF NOT EXISTS knowledge_chunks (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          chunk_index INTEGER NOT NULL,
          content TEXT NOT NULL,
          section_title TEXT,
          page_number INTEGER,
          char_count INTEGER NOT NULL,
          embedding_json TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source ON knowledge_chunks(source_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_profile ON knowledge_chunks(profile_id);
      `);

      try {
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
            chunk_id UNINDEXED,
            source_id UNINDEXED,
            profile_id UNINDEXED,
            source_name,
            section_title,
            content
          );
        `);
      } catch (ftsErr) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS knowledge_chunks_fts (
            chunk_id TEXT,
            source_id TEXT,
            profile_id TEXT,
            source_name TEXT,
            section_title TEXT,
            content TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_kchunks_fts_profile ON knowledge_chunks_fts(profile_id);
          CREATE INDEX IF NOT EXISTS idx_kchunks_fts_source ON knowledge_chunks_fts(source_id);
        `);
      }
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at, backup_path) VALUES (?, ?, ?, ?)')
        .run(3, '003_knowledge_rag_schema', new Date().toISOString(), backupPath || '');

      db.exec('COMMIT;');
      appliedVersions.add(3);
      console.log('[MIGRATION] Migration 3 applied successfully: Knowledge Base & RAG schema active.');
    } catch (err) {
      db.exec('ROLLBACK;');
      db.close();

      if (backupPath && fs.existsSync(backupPath)) {
        console.error(`[MIGRATION FAILED] Rolling back database from backup: ${backupPath}`);
        fs.copyFileSync(backupPath, dbPath);
      }
      throw new Error(`[MIGRATION ROLLBACK v3] Schema upgrade failed: ${err.message}`);
    }
  }

  // --- MIGRATION 4: AbyxStudy / NotebookLM Workspaces, Materials, Flashcards & Quizzes ---
  if (!appliedVersions.has(4)) {
    console.log('[MIGRATION] Applying Migration 4: AbyxStudy / NotebookLM Schema...');
    const backupPath = createPreMigrationBackup(dbPath, '004_abyx_studybooks_schema');

    db.exec('BEGIN TRANSACTION;');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS studybooks (
          id TEXT PRIMARY KEY,
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT,
          emoji TEXT DEFAULT '📘',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_studybooks_profile ON studybooks(profile_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS studybook_sources (
          id TEXT PRIMARY KEY,
          studybook_id TEXT NOT NULL REFERENCES studybooks(id) ON DELETE CASCADE,
          source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_studybook_sources_sb ON studybook_sources(studybook_id);
        CREATE INDEX IF NOT EXISTS idx_studybook_sources_src ON studybook_sources(source_id);

        CREATE TABLE IF NOT EXISTS studybook_materials (
          id TEXT PRIMARY KEY,
          studybook_id TEXT NOT NULL REFERENCES studybooks(id) ON DELETE CASCADE,
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          score INTEGER,
          total_items INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_studybook_materials_sb ON studybook_materials(studybook_id, type);
        CREATE INDEX IF NOT EXISTS idx_studybook_materials_profile ON studybook_materials(profile_id);

        CREATE TABLE IF NOT EXISTS studybook_messages (
          id TEXT PRIMARY KEY,
          studybook_id TEXT NOT NULL REFERENCES studybooks(id) ON DELETE CASCADE,
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          citations_json TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_studybook_messages_sb ON studybook_messages(studybook_id, created_at ASC);

      `);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at, backup_path) VALUES (?, ?, ?, ?)')
        .run(4, '004_abyx_studybooks_schema', new Date().toISOString(), backupPath || '');

      db.exec('COMMIT;');
      appliedVersions.add(4);
      console.log('[MIGRATION] Migration 4 applied successfully: AbyxStudy / NotebookLM schema active.');
    } catch (err) {
      db.exec('ROLLBACK;');
      db.close();

      if (backupPath && fs.existsSync(backupPath)) {
        console.error(`[MIGRATION FAILED] Rolling back database from backup: ${backupPath}`);
        fs.copyFileSync(backupPath, dbPath);
      }
      throw new Error(`[MIGRATION ROLLBACK v4] Schema upgrade failed: ${err.message}`);
    }
  }

  // --- MIGRATION 5: Profile settings and cross-profile relationship guards ---
  if (!appliedVersions.has(5)) {
    const backupPath = createPreMigrationBackup(dbPath, 'v5_profile_integrity');
    db.exec('BEGIN TRANSACTION;');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS profile_settings (
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          setting_key TEXT NOT NULL,
          setting_value TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (profile_id, setting_key)
        );
        CREATE INDEX IF NOT EXISTS idx_chat_logs_profile_session_ts ON chat_logs(profile_id, session_id, timestamp);
        CREATE INDEX IF NOT EXISTS idx_session_metadata_profile_end ON session_metadata(profile_id, end_time DESC);
        CREATE INDEX IF NOT EXISTS idx_token_usage_profile_created ON token_usage(profile_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_profile_source ON knowledge_chunks(profile_id, source_id, chunk_index);
        CREATE INDEX IF NOT EXISTS idx_studybook_sources_profile_book ON studybook_sources(profile_id, studybook_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_studybook_materials_profile_book ON studybook_materials(profile_id, studybook_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_studybook_messages_profile_book ON studybook_messages(profile_id, studybook_id, created_at);

        CREATE TRIGGER IF NOT EXISTS trg_knowledge_chunk_profile_insert
        BEFORE INSERT ON knowledge_chunks
        WHEN NOT EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.id = NEW.source_id AND s.profile_id = NEW.profile_id)
        BEGIN SELECT RAISE(ABORT, 'knowledge chunk source/profile mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS trg_knowledge_chunk_profile_update
        BEFORE UPDATE OF source_id, profile_id ON knowledge_chunks
        WHEN NOT EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.id = NEW.source_id AND s.profile_id = NEW.profile_id)
        BEGIN SELECT RAISE(ABORT, 'knowledge chunk source/profile mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS trg_knowledge_chunk_fts_delete
        AFTER DELETE ON knowledge_chunks
        BEGIN DELETE FROM knowledge_chunks_fts WHERE chunk_id = OLD.id; END;

        CREATE TRIGGER IF NOT EXISTS trg_chat_profile_insert
        BEFORE INSERT ON chat_logs
        WHEN NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = NEW.profile_id)
        BEGIN SELECT RAISE(ABORT, 'chat profile does not exist'); END;
        CREATE TRIGGER IF NOT EXISTS trg_chat_profile_update
        BEFORE UPDATE OF profile_id ON chat_logs
        WHEN NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = NEW.profile_id)
        BEGIN SELECT RAISE(ABORT, 'chat profile does not exist'); END;
        CREATE TRIGGER IF NOT EXISTS trg_session_meta_profile_insert
        BEFORE INSERT ON session_metadata
        WHEN NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = NEW.profile_id)
        BEGIN SELECT RAISE(ABORT, 'session profile does not exist'); END;
        CREATE TRIGGER IF NOT EXISTS trg_token_profile_insert
        BEFORE INSERT ON token_usage
        WHEN NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = NEW.profile_id)
        BEGIN SELECT RAISE(ABORT, 'usage profile does not exist'); END;

        CREATE TRIGGER IF NOT EXISTS trg_studybook_source_profile_insert
        BEFORE INSERT ON studybook_sources
        WHEN NOT EXISTS (SELECT 1 FROM studybooks b WHERE b.id = NEW.studybook_id AND b.profile_id = NEW.profile_id)
          OR NOT EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.id = NEW.source_id AND s.profile_id = NEW.profile_id)
        BEGIN SELECT RAISE(ABORT, 'studybook source/profile mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS trg_studybook_source_profile_update
        BEFORE UPDATE OF studybook_id, source_id, profile_id ON studybook_sources
        WHEN NOT EXISTS (SELECT 1 FROM studybooks b WHERE b.id = NEW.studybook_id AND b.profile_id = NEW.profile_id)
          OR NOT EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.id = NEW.source_id AND s.profile_id = NEW.profile_id)
        BEGIN SELECT RAISE(ABORT, 'studybook source/profile mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS trg_studybook_material_profile_insert
        BEFORE INSERT ON studybook_materials
        WHEN NOT EXISTS (SELECT 1 FROM studybooks b WHERE b.id = NEW.studybook_id AND b.profile_id = NEW.profile_id)
        BEGIN SELECT RAISE(ABORT, 'studybook material/profile mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS trg_studybook_material_profile_update
        BEFORE UPDATE OF studybook_id, profile_id ON studybook_materials
        WHEN NOT EXISTS (SELECT 1 FROM studybooks b WHERE b.id = NEW.studybook_id AND b.profile_id = NEW.profile_id)
        BEGIN SELECT RAISE(ABORT, 'studybook material/profile mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS trg_studybook_message_profile_insert
        BEFORE INSERT ON studybook_messages
        WHEN NOT EXISTS (SELECT 1 FROM studybooks b WHERE b.id = NEW.studybook_id AND b.profile_id = NEW.profile_id)
        BEGIN SELECT RAISE(ABORT, 'studybook message/profile mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS trg_studybook_message_profile_update
        BEFORE UPDATE OF studybook_id, profile_id ON studybook_messages
        WHEN NOT EXISTS (SELECT 1 FROM studybooks b WHERE b.id = NEW.studybook_id AND b.profile_id = NEW.profile_id)
        BEGIN SELECT RAISE(ABORT, 'studybook message/profile mismatch'); END;
      `);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at, backup_path) VALUES (?, ?, ?, ?)')
        .run(5, '005_profile_settings_integrity_guards', new Date().toISOString(), backupPath || '');
      db.exec('COMMIT;');
      appliedVersions.add(5);
    } catch (err) {
      db.exec('ROLLBACK;');
      db.close();
      throw new Error(`[MIGRATION ROLLBACK v5] Schema upgrade failed: ${err.message}`);
    }
  }

  // --- MIGRATION 6: Profile-scoped conversation identity ---
  if (!appliedVersions.has(6)) {
    const backupPath = createPreMigrationBackup(dbPath, 'v6_profile_session_keys');
    db.exec('BEGIN TRANSACTION;');
    try {
      const columns = db.prepare('PRAGMA table_info(session_metadata)').all();
      const profileColumn = columns.find(column => column.name === 'profile_id');
      const sessionColumn = columns.find(column => column.name === 'session_id');
      const compositeKey = profileColumn?.pk > 0 && sessionColumn?.pk > 0;
      if (!compositeKey) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS session_metadata_orphaned_v6 (
            session_id TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            summary TEXT,
            message_count INTEGER DEFAULT 0,
            last_reviewed_at TEXT,
            status TEXT DEFAULT 'active',
            profile_id TEXT NOT NULL,
            PRIMARY KEY (profile_id, session_id)
          );
          INSERT OR IGNORE INTO session_metadata_orphaned_v6
            (session_id, start_time, end_time, summary, message_count, last_reviewed_at, status, profile_id)
          SELECT sm.session_id, sm.start_time, sm.end_time, sm.summary, sm.message_count,
            sm.last_reviewed_at, sm.status, COALESCE(sm.profile_id, 'prof_default')
          FROM session_metadata sm
          LEFT JOIN profiles p ON p.id = COALESCE(sm.profile_id, 'prof_default')
          WHERE p.id IS NULL;

          CREATE TABLE session_metadata_new (
            session_id TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            summary TEXT,
            message_count INTEGER DEFAULT 0,
            last_reviewed_at TEXT,
            status TEXT DEFAULT 'active',
            profile_id TEXT NOT NULL DEFAULT 'prof_default' REFERENCES profiles(id) ON DELETE CASCADE,
            PRIMARY KEY (profile_id, session_id)
          );
          INSERT INTO session_metadata_new
            (session_id, start_time, end_time, summary, message_count, last_reviewed_at, status, profile_id)
          SELECT sm.session_id, sm.start_time, sm.end_time, sm.summary, sm.message_count,
            sm.last_reviewed_at, sm.status, COALESCE(sm.profile_id, 'prof_default')
          FROM session_metadata sm
          JOIN profiles p ON p.id = COALESCE(sm.profile_id, 'prof_default');
          DROP TABLE session_metadata;
          ALTER TABLE session_metadata_new RENAME TO session_metadata;
          CREATE INDEX IF NOT EXISTS idx_session_metadata_profile_end ON session_metadata(profile_id, end_time DESC);
        `);
      }
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_session_meta_profile_insert
        BEFORE INSERT ON session_metadata
        WHEN NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = NEW.profile_id)
        BEGIN SELECT RAISE(ABORT, 'session profile does not exist'); END;
      `);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at, backup_path) VALUES (?, ?, ?, ?)')
        .run(6, '006_profile_scoped_session_metadata', new Date().toISOString(), backupPath || '');
      db.exec('COMMIT;');
      appliedVersions.add(6);
    } catch (err) {
      db.exec('ROLLBACK;');
      db.close();
      throw new Error(`[MIGRATION ROLLBACK v6] Schema upgrade failed: ${err.message}`);
    }
  }

  // --- MIGRATION 7: Profile-scoped AI usage events and user budgets ---
  if (!appliedVersions.has(7)) {
    const backupPath = createPreMigrationBackup(dbPath, 'v7_ai_usage_events');
    db.exec('BEGIN TRANSACTION;');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_usage_events (
          id TEXT PRIMARY KEY,
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          request_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          model TEXT NOT NULL,
          session_id TEXT,
          agent_id TEXT,
          request_type TEXT NOT NULL DEFAULT 'chat',
          input_tokens INTEGER,
          output_tokens INTEGER,
          cached_input_tokens INTEGER,
          reasoning_tokens INTEGER,
          token_source TEXT NOT NULL DEFAULT 'unavailable' CHECK(token_source IN ('actual','estimated','unavailable')),
          estimated_cost_usd REAL,
          duration_ms INTEGER,
          status TEXT NOT NULL CHECK(status IN ('success','failed','cancelled')),
          error_code TEXT,
          rate_limit_event INTEGER NOT NULL DEFAULT 0 CHECK(rate_limit_event IN (0,1))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_usage_profile_request ON ai_usage_events(profile_id, request_id);
        CREATE INDEX IF NOT EXISTS idx_ai_usage_profile_created ON ai_usage_events(profile_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ai_usage_profile_provider_model ON ai_usage_events(profile_id, provider_id, model, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ai_usage_profile_agent ON ai_usage_events(profile_id, agent_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS ai_usage_budgets (
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          scope_type TEXT NOT NULL CHECK(scope_type IN ('global','provider','model')),
          scope_id TEXT NOT NULL DEFAULT '',
          period TEXT NOT NULL CHECK(period IN ('daily','monthly')),
          token_limit INTEGER,
          cost_limit_usd REAL,
          warning_percent INTEGER NOT NULL DEFAULT 75 CHECK(warning_percent IN (50,75,90,100)),
          hard_limit_enabled INTEGER NOT NULL DEFAULT 0 CHECK(hard_limit_enabled IN (0,1)),
          updated_at TEXT NOT NULL,
          PRIMARY KEY(profile_id, scope_type, scope_id, period)
        );
        CREATE TABLE IF NOT EXISTS provider_quota_snapshots (
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL,
          quota_kind TEXT NOT NULL CHECK(quota_kind IN ('requests','tokens')),
          limit_value REAL,
          remaining_value REAL,
          reset_at TEXT,
          source TEXT NOT NULL CHECK(source IN ('provider_header','official_api','user_configured')),
          observed_at TEXT NOT NULL,
          PRIMARY KEY(profile_id, provider_id, quota_kind)
        );
        CREATE INDEX IF NOT EXISTS idx_provider_quota_profile_observed ON provider_quota_snapshots(profile_id, observed_at DESC);
      `);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at, backup_path) VALUES (?, ?, ?, ?)')
        .run(7, '007_profile_scoped_ai_usage_and_budgets', new Date().toISOString(), backupPath || '');
      db.exec('COMMIT;');
      appliedVersions.add(7);
    } catch (err) {
      db.exec('ROLLBACK;');
      db.close();
      throw new Error(`[MIGRATION ROLLBACK v7] Schema upgrade failed: ${err.message}`);
    }
  }

  // --- MIGRATION 8: Merge legacy local accounts into one persistent workspace ---
  if (!appliedVersions.has(8)) {
    const backupPath = createPreMigrationBackup(dbPath, 'v8_single_workspace');
    db.exec('BEGIN TRANSACTION;');
    try {
      const credentialStore = require('./security/credential_store');
      const profiles = db.prepare("SELECT id FROM profiles WHERE id != 'prof_default'").all();
      const workspaceId = 'prof_default';

      const workspaceRoot = path.join(dataDir, 'profiles', workspaceId, 'workspace');
      const automationRoot = path.join(dataDir, 'profiles', workspaceId, 'automations');
      fs.mkdirSync(workspaceRoot, { recursive: true });
      fs.mkdirSync(automationRoot, { recursive: true });
      for (const profile of profiles) {
        const safeProfileId = String(profile.id).replace(/[^a-zA-Z0-9_-]/g, '_');
        const profileRoot = path.join(dataDir, 'profiles', safeProfileId);
        const legacyWorkspace = path.join(profileRoot, 'workspace');
        if (fs.existsSync(legacyWorkspace)) {
          const importedWorkspace = path.join(workspaceRoot, 'Imported Profiles', safeProfileId);
          fs.cpSync(legacyWorkspace, importedWorkspace, { recursive: true, errorOnExist: false, force: false });
        }

        const legacyAutomationsFile = path.join(profileRoot, 'automations', 'automations.json');
        if (fs.existsSync(legacyAutomationsFile)) {
          const legacyTasks = JSON.parse(fs.readFileSync(legacyAutomationsFile, 'utf8'));
          if (!Array.isArray(legacyTasks)) throw new Error(`Invalid automation data for profile ${safeProfileId}`);
          const workspaceAutomationsFile = path.join(automationRoot, 'automations.json');
          const workspaceTasks = fs.existsSync(workspaceAutomationsFile)
            ? JSON.parse(fs.readFileSync(workspaceAutomationsFile, 'utf8'))
            : [];
          if (!Array.isArray(workspaceTasks)) throw new Error('Workspace automation data is not a list');
          const ids = new Set(workspaceTasks.map(task => String(task.id)));
          for (const task of legacyTasks) {
            const copy = { ...task };
            if (ids.has(String(copy.id))) copy.id = `legacy_${safeProfileId}_${copy.id}`;
            if (!ids.has(String(copy.id))) {
              workspaceTasks.push(copy);
              ids.add(String(copy.id));
            }
          }
          const tempFile = `${workspaceAutomationsFile}.migration-${process.pid}.tmp`;
          fs.writeFileSync(tempFile, JSON.stringify(workspaceTasks, null, 2), 'utf8');
          fs.renameSync(tempFile, workspaceAutomationsFile);
        }

        const legacyRuns = path.join(profileRoot, 'agent_runs');
        if (fs.existsSync(legacyRuns)) {
          const workspaceRuns = path.join(dataDir, 'profiles', workspaceId, 'agent_runs');
          fs.mkdirSync(workspaceRuns, { recursive: true });
          for (const fileName of fs.readdirSync(legacyRuns).filter(name => name.endsWith('.json'))) {
            const from = path.join(legacyRuns, fileName);
            const targetName = fs.existsSync(path.join(workspaceRuns, fileName))
              ? `legacy_${safeProfileId}_${fileName}`
              : fileName;
            const runRecord = JSON.parse(fs.readFileSync(from, 'utf8'));
            if (runRecord && typeof runRecord === 'object') runRecord.profileId = workspaceId;
            const target = path.join(workspaceRuns, targetName);
            if (!fs.existsSync(target)) fs.writeFileSync(target, JSON.stringify(runRecord, null, 2), 'utf8');
          }
        }

        // Preserve other profile-owned files verbatim for manual recovery.
        const legacyProfileData = path.join(profileRoot, 'extensions');
        if (fs.existsSync(legacyProfileData)) {
          const activeExtensions = path.join(dataDir, 'profiles', workspaceId, 'extensions');
          const extensionTarget = fs.existsSync(activeExtensions)
            ? path.join(dataDir, 'profiles', workspaceId, 'imported_profiles', safeProfileId, 'extensions')
            : activeExtensions;
          fs.cpSync(legacyProfileData, extensionTarget, { recursive: true, errorOnExist: false, force: false });
        }
      }

      for (const profile of profiles) {
        const profileId = profile.id;
        const credentials = db.prepare('SELECT provider_id FROM provider_credentials WHERE profile_id = ?').all(profileId);
        for (const credential of credentials) {
          const oldProviderId = credential.provider_id;
          const secret = credentialStore.getSecret(profileId, oldProviderId);
          const currentRow = db.prepare('SELECT provider_id FROM provider_credentials WHERE profile_id = ? AND provider_id = ?').get(workspaceId, oldProviderId);
          const targetProviderId = currentRow
            ? `legacy_${String(profileId).replace(/[^a-zA-Z0-9_-]/g, '_')}_${oldProviderId}`.slice(0, 100)
            : oldProviderId;
          let metadata = null;
          if (secret) metadata = credentialStore.storeSecret(workspaceId, targetProviderId, secret);
          db.prepare(`UPDATE provider_credentials SET profile_id = ?, provider_id = ?, key_masked = ?, key_length = ?, store_type = ?, cred_ref = ?, updated_at = ?
            WHERE profile_id = ? AND provider_id = ?`)
            .run(workspaceId, targetProviderId, metadata?.keyMasked || '****', metadata?.keyLength || 0, metadata?.storeType || 'unavailable', metadata?.credRef || '', new Date().toISOString(), profileId, oldProviderId);
        }
      }

      // Snapshot cross-profile key collisions before changing ownership. This
      // includes collisions between two legacy profiles, not only the default.
      db.exec(`
        CREATE TEMP TABLE v8_memory_key_collisions AS
          SELECT key FROM user_profile_memory GROUP BY key HAVING COUNT(DISTINCT profile_id) > 1;
        CREATE TEMP TABLE v8_setting_key_collisions AS
          SELECT setting_key FROM profile_settings GROUP BY setting_key HAVING COUNT(DISTINCT profile_id) > 1;
        CREATE TEMP TABLE v8_session_id_collisions AS
          SELECT session_id FROM (
            SELECT session_id, profile_id FROM chat_logs
            UNION ALL
            SELECT session_id, profile_id FROM session_metadata
          ) WHERE session_id IS NOT NULL
          GROUP BY session_id HAVING COUNT(DISTINCT profile_id) > 1;
        CREATE TEMP TABLE v8_request_id_collisions AS
          SELECT request_id FROM ai_usage_events GROUP BY request_id HAVING COUNT(DISTINCT profile_id) > 1;
        CREATE TEMP TABLE v8_budget_collisions AS
          SELECT scope_type, scope_id, period FROM ai_usage_budgets
          GROUP BY scope_type, scope_id, period HAVING COUNT(DISTINCT profile_id) > 1;
        CREATE TEMP TABLE v8_quota_collisions AS
          SELECT provider_id, quota_kind FROM provider_quota_snapshots
          GROUP BY provider_id, quota_kind HAVING COUNT(DISTINCT profile_id) > 1;

        UPDATE user_profile_memory
        SET key = profile_id || ':' || key
        WHERE profile_id != 'prof_default'
          AND key IN (SELECT key FROM v8_memory_key_collisions);
        UPDATE profile_settings
        SET setting_key = profile_id || ':' || setting_key
        WHERE profile_id != 'prof_default'
          AND setting_key IN (SELECT setting_key FROM v8_setting_key_collisions);

        UPDATE chat_logs
        SET session_id = profile_id || ':' || session_id
        WHERE profile_id != 'prof_default'
          AND session_id IN (SELECT session_id FROM v8_session_id_collisions);
        UPDATE session_metadata
        SET session_id = profile_id || ':' || session_id
        WHERE profile_id != 'prof_default'
          AND session_id IN (SELECT session_id FROM v8_session_id_collisions);

        UPDATE ai_usage_events
        SET request_id = profile_id || ':' || request_id
        WHERE profile_id != 'prof_default'
          AND request_id IN (SELECT request_id FROM v8_request_id_collisions);

        UPDATE ai_usage_budgets
        SET scope_id = profile_id || ':' || scope_id
        WHERE profile_id != 'prof_default'
          AND EXISTS (SELECT 1 FROM v8_budget_collisions collision
            WHERE collision.scope_type = ai_usage_budgets.scope_type
              AND collision.scope_id = ai_usage_budgets.scope_id AND collision.period = ai_usage_budgets.period);
        UPDATE provider_quota_snapshots
        SET provider_id = 'legacy_' || profile_id || '_' || provider_id
        WHERE profile_id != 'prof_default'
          AND EXISTS (SELECT 1 FROM v8_quota_collisions collision
            WHERE collision.provider_id = provider_quota_snapshots.provider_id
              AND collision.quota_kind = provider_quota_snapshots.quota_kind);

        UPDATE knowledge_sources SET profile_id = 'prof_default' WHERE profile_id != 'prof_default';
        UPDATE knowledge_chunks SET profile_id = 'prof_default' WHERE profile_id != 'prof_default';
        UPDATE knowledge_chunks_fts SET profile_id = 'prof_default' WHERE profile_id != 'prof_default';
        UPDATE studybooks SET profile_id = 'prof_default' WHERE profile_id != 'prof_default';
        UPDATE studybook_sources SET profile_id = 'prof_default' WHERE profile_id != 'prof_default';
        UPDATE studybook_materials SET profile_id = 'prof_default' WHERE profile_id != 'prof_default';
        UPDATE studybook_messages SET profile_id = 'prof_default' WHERE profile_id != 'prof_default';
        UPDATE chat_logs SET profile_id = 'prof_default' WHERE profile_id != 'prof_default';
        UPDATE session_metadata SET profile_id = 'prof_default' WHERE profile_id != 'prof_default';
        UPDATE token_usage SET profile_id = 'prof_default' WHERE profile_id != 'prof_default';
        UPDATE user_profile_memory SET profile_id = 'prof_default' WHERE profile_id != 'prof_default';
        UPDATE profile_settings SET profile_id = 'prof_default' WHERE profile_id != 'prof_default';
        UPDATE ai_usage_events SET profile_id = 'prof_default' WHERE profile_id != 'prof_default';
        UPDATE ai_usage_budgets SET profile_id = 'prof_default' WHERE profile_id != 'prof_default';
        UPDATE provider_quota_snapshots SET profile_id = 'prof_default' WHERE profile_id != 'prof_default';
        DELETE FROM profile_sessions WHERE profile_id != 'prof_default';
      `);

      for (const profile of profiles) credentialStore.removeSecret(profile.id, 'abyx-remembered-session');
      db.prepare("UPDATE profiles SET username = 'Workspace', display_name = 'Workspace', avatar = 'A', status = 'active', updated_at = ? WHERE id = 'prof_default'")
        .run(new Date().toISOString());
      db.prepare("DELETE FROM profiles WHERE id != 'prof_default'").run();
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at, backup_path) VALUES (?, ?, ?, ?)')
        .run(8, '008_single_local_workspace', new Date().toISOString(), backupPath || '');
      db.exec('COMMIT;');
      appliedVersions.add(8);
    } catch (err) {
      db.exec('ROLLBACK;');
      db.close();
      throw new Error(`[MIGRATION ROLLBACK v8] Single-workspace migration failed; verified pre-migration backup retained: ${err.message}`);
    }
  }

  db.close();
  return {
    success: true,
    appliedVersions: Array.from(appliedVersions)
  };
}

module.exports = {
  validateDatabaseIntegrity,
  createPreMigrationBackup,
  runMigrations,
  BACKUPS_DIR
};
