import React, { useState, useEffect, useCallback } from "react";
import {
  FolderKanban,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderCheck,
  FileText,
  FileCode,
  Search,
  Plus,
  Trash2,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Edit3,
  Eye,
  Check,
  X,
  MessageSquare,
  File,
  HardDrive
} from "lucide-react";
import {
  getWorkspaces,
  createWorkspace,
  setActiveWorkspace,
  deleteWorkspace,
  selectWorkspaceFolder,
  openWorkspaceFolder,
  getWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  editWorkspaceFile,
  searchWorkspaceFiles,
  deleteWorkspaceFile,
  formatBytes
} from "../services/api";

export default function ProjectsManager({ onNavigateToChat, onActiveWorkspaceChanged }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Create Project Modal State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Files Explorer State
  const [files, setFiles] = useState([]);
  const [currentDir, setCurrentDir] = useState(".");
  const [filesLoading, setFilesLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);

  // File Viewer / Editor Modal State
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileEditMode, setFileEditMode] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState("");
  const [replaceReplacement, setReplaceReplacement] = useState("");
  const [fileSaving, setFileSaving] = useState(false);
  const [fileActionError, setFileActionError] = useState(null);
  const [fileActionSuccess, setFileActionSuccess] = useState(null);

  // New File Modal State
  const [newFileModalOpen, setNewFileModalOpen] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileContent, setNewFileContent] = useState("");
  const [newFileSubmitting, setNewFileSubmitting] = useState(false);
  const [newFileError, setNewFileError] = useState(null);

  const showSuccess = (msg) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getWorkspaces();
      if (data?.ok) {
        setWorkspaces(data.workspaces || []);
        setActiveWorkspaceId(data.activeWorkspace || (data.workspaces[0] ? data.workspaces[0].id : null));
        if (onActiveWorkspaceChanged && data.activeProject) {
          onActiveWorkspaceChanged(data.activeProject);
        }
      } else {
        setError(data?.error || "Could not load projects");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [onActiveWorkspaceChanged]);

  const loadFiles = useCallback(async (dir = ".") => {
    setFilesLoading(true);
    setSearchResults(null);
    try {
      const res = await getWorkspaceFiles(dir);
      if (res?.ok) {
        setFiles(res.entries || []);
        setCurrentDir(dir);
      } else {
        setError(res?.error || "Could not load project files");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    if (activeWorkspaceId) {
      loadFiles(".");
    }
  }, [activeWorkspaceId, loadFiles]);

  const activeProject = workspaces.find((w) => w.id === activeWorkspaceId);

  const handleSwitchProject = async (id) => {
    const target = workspaces.find((w) => w.id === id);
    if (!target) return;
    if (!target.available) {
      setError(`Cannot activate project: Folder "${target.path}" is missing or unavailable on disk.`);
      return;
    }
    try {
      const res = await setActiveWorkspace(id);
      if (res?.ok) {
        setActiveWorkspaceId(id);
        showSuccess(`Switched active workspace to "${target.name}"`);
        loadWorkspaces();
        loadFiles(".");
      } else {
        setError(res?.error || "Could not switch active project");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleBrowseNativeFolder = async () => {
    try {
      const res = await selectWorkspaceFolder();
      if (res?.ok && res.path) {
        setProjectPath(res.path);
        if (!projectName) {
          const parts = res.path.replace(/[\\/]+$/, "").split(/[\\/]/);
          setProjectName(parts[parts.length - 1] || "My Project");
        }
      }
    } catch (err) {
      setCreateError("Folder picker failed: " + err.message);
    }
  };

  const handleCreateProject = async (e) => {
    e.preventDefault();
    if (!projectName.trim()) {
      setCreateError("Project name is required.");
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const res = await createWorkspace({
        name: projectName.trim(),
        path: projectPath.trim() || undefined
      });
      if (res?.ok) {
        showSuccess(`Project "${projectName}" created successfully!`);
        setCreateModalOpen(false);
        setProjectName("");
        setProjectPath("");
        loadWorkspaces();
      } else {
        setCreateError(res?.error || "Failed to create project");
      }
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleDeleteProject = async (ws) => {
    if (workspaces.length <= 1) {
      setError("Cannot delete the only project in the application.");
      return;
    }
    if (!window.confirm(`Remove project "${ws.name}" from Local AI Studio?\n\nNote: Your files at "${ws.path}" will remain safe on your PC.`)) {
      return;
    }
    try {
      const res = await deleteWorkspace(ws.id);
      if (res?.ok) {
        showSuccess(`Project "${ws.name}" removed from workspace list.`);
        loadWorkspaces();
      } else {
        setError(res?.error || "Failed to delete project");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleOpenInExplorer = async (ws) => {
    try {
      const res = await openWorkspaceFolder(ws?.id);
      if (res?.ok) {
        showSuccess(`Opening "${ws.name}" in Windows Explorer...`);
      } else {
        setError(res?.error || "Could not open folder in Explorer");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSearchFiles = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setIsSearching(true);
    try {
      const res = await searchWorkspaceFiles(searchQuery.trim());
      if (res?.ok) {
        setSearchResults(res.matches || []);
      } else {
        setError(res?.error || "Search failed");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSearching(false);
    }
  };

  const handleOpenFile = async (fileItem) => {
    setSelectedFile(fileItem);
    setFileLoading(true);
    setFileEditMode(false);
    setFileActionError(null);
    setFileActionSuccess(null);
    setReplaceTarget("");
    setReplaceReplacement("");
    try {
      const res = await readWorkspaceFile(fileItem.path || fileItem.name);
      if (res?.ok) {
        setFileContent(res.content || "");
      } else {
        setFileActionError(res?.error || "Failed to read file");
      }
    } catch (err) {
      setFileActionError(err.message);
    } finally {
      setFileLoading(false);
    }
  };

  const handleSaveFileContent = async () => {
    if (!selectedFile) return;
    setFileSaving(true);
    setFileActionError(null);
    setFileActionSuccess(null);
    try {
      const res = await writeWorkspaceFile(selectedFile.path || selectedFile.name, fileContent);
      if (res?.ok) {
        setFileActionSuccess("File saved successfully!");
        loadFiles(currentDir);
      } else {
        setFileActionError(res?.error || "Failed to save file");
      }
    } catch (err) {
      setFileActionError(err.message);
    } finally {
      setFileSaving(false);
    }
  };

  const handleSurgicalReplace = async (e) => {
    e.preventDefault();
    if (!selectedFile || !replaceTarget) return;
    setFileSaving(true);
    setFileActionError(null);
    setFileActionSuccess(null);
    try {
      const res = await editWorkspaceFile(
        selectedFile.path || selectedFile.name,
        replaceTarget,
        replaceReplacement
      );
      if (res?.ok) {
        setFileActionSuccess("Surgical replace applied successfully!");
        // Reload file content
        const readRes = await readWorkspaceFile(selectedFile.path || selectedFile.name);
        if (readRes?.ok) {
          setFileContent(readRes.content || "");
        }
        setReplaceTarget("");
        setReplaceReplacement("");
        loadFiles(currentDir);
      } else {
        setFileActionError(res?.error || "Surgical replace failed");
      }
    } catch (err) {
      setFileActionError(err.message);
    } finally {
      setFileSaving(false);
    }
  };

  const handleDeleteFile = async (filePath) => {
    if (!window.confirm(`Permanently delete "${filePath}" from project?`)) return;
    try {
      const res = await deleteWorkspaceFile(filePath);
      if (res?.ok) {
        showSuccess(`Deleted "${filePath}"`);
        if (selectedFile && (selectedFile.path === filePath || selectedFile.name === filePath)) {
          setSelectedFile(null);
        }
        loadFiles(currentDir);
      } else {
        setError(res?.error || "Failed to delete file");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateNewFile = async (e) => {
    e.preventDefault();
    if (!newFileName.trim()) {
      setNewFileError("Filename is required");
      return;
    }
    setNewFileSubmitting(true);
    setNewFileError(null);
    try {
      const fullRelative = currentDir && currentDir !== "." ? `${currentDir}/${newFileName.trim()}` : newFileName.trim();
      const res = await writeWorkspaceFile(fullRelative, newFileContent);
      if (res?.ok) {
        showSuccess(`Created file "${newFileName}"!`);
        setNewFileModalOpen(false);
        setNewFileName("");
        setNewFileContent("");
        loadFiles(currentDir);
      } else {
        setNewFileError(res?.error || "Failed to create file");
      }
    } catch (err) {
      setNewFileError(err.message);
    } finally {
      setNewFileSubmitting(false);
    }
  };

  return (
    <div className="abyx-page-container">
      {/* Page Header */}
      <div className="abyx-page-header">
        <div className="abyx-page-title-row">
          <div className="abyx-page-title-wrap">
            <FolderKanban className="abyx-header-icon" size={26} />
            <div>
              <h1 className="abyx-page-title">Projects & Workspace</h1>
              <p className="abyx-page-subtitle">
                Manage project folders on your PC. The AI is strictly bounded to work inside the active project folder.
              </p>
            </div>
          </div>
          <div className="abyx-header-actions">
            <button
              type="button"
              className="abyx-btn abyx-btn-secondary"
              onClick={() => {
                loadWorkspaces();
                if (activeWorkspaceId) loadFiles(currentDir);
              }}
              title="Refresh projects and files"
            >
              <RefreshCw size={15} className={loading || filesLoading ? "abyx-spin" : ""} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              className="abyx-btn abyx-btn-primary"
              onClick={() => {
                setCreateError(null);
                setCreateModalOpen(true);
              }}
            >
              <FolderPlus size={16} />
              <span>Create Project</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="abyx-alert abyx-alert-error" role="alert">
            <AlertTriangle size={16} />
            <span>{error}</span>
            <button type="button" className="abyx-alert-close" onClick={() => setError(null)}>
              <X size={14} />
            </button>
          </div>
        )}

        {successMessage && (
          <div className="abyx-alert abyx-alert-success" role="status">
            <CheckCircle2 size={16} />
            <span>{successMessage}</span>
          </div>
        )}
      </div>

      {/* Active Project Hero Banner */}
      {activeProject && (
        <div className={`abyx-project-hero-card ${activeProject.available ? "active-hero" : "missing-hero"}`}>
          <div className="hero-left">
            <div className="hero-icon-badge">
              <FolderOpen size={24} />
            </div>
            <div className="hero-details">
              <div className="hero-tag-row">
                <span className="hero-label">ACTIVE WORKSPACE</span>
                {activeProject.available ? (
                  <span className="abyx-status-pill ready">
                    <ShieldCheck size={13} />
                    <span>Protected Boundary Active</span>
                  </span>
                ) : (
                  <span className="abyx-status-pill error">
                    <AlertTriangle size={13} />
                    <span>Folder Missing on Disk</span>
                  </span>
                )}
              </div>
              <h2 className="hero-title">{activeProject.name}</h2>
              <div className="hero-path-box" title={activeProject.path}>
                <HardDrive size={13} />
                <code>{activeProject.path}</code>
              </div>
            </div>
          </div>
          <div className="hero-actions">
            <button
              type="button"
              className="abyx-btn abyx-btn-secondary"
              onClick={() => handleOpenInExplorer(activeProject)}
              title="Open project folder in Windows Explorer"
            >
              <ExternalLink size={15} />
              <span>Open in Explorer</span>
            </button>
            {onNavigateToChat && (
              <button
                type="button"
                className="abyx-btn abyx-btn-primary"
                onClick={() => onNavigateToChat(activeProject)}
                title="Chat with AI in this workspace"
              >
                <MessageSquare size={15} />
                <span>Chat in Workspace</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Projects Grid */}
      <div className="abyx-section-heading">
        <h3 className="section-title">All Registered Projects ({workspaces.length})</h3>
        <span className="section-desc">Projects persist in configuration. Switch active workspace with one click.</span>
      </div>

      <div className="abyx-projects-grid">
        {workspaces.map((ws) => {
          const isActive = ws.id === activeWorkspaceId;
          return (
            <div
              key={ws.id}
              className={`abyx-project-card ${isActive ? "card-active" : ""} ${!ws.available ? "card-unavailable" : ""}`}
            >
              <div className="project-card-header">
                <div className="project-card-title-row">
                  <Folder className="project-folder-icon" size={18} />
                  <span className="project-card-name" title={ws.name}>{ws.name}</span>
                </div>
                <div className="project-card-badges">
                  {isActive && (
                    <span className="abyx-status-pill ready" title="Currently active project">
                      <Check size={11} />
                      <span>Active</span>
                    </span>
                  )}
                  {!ws.available && (
                    <span className="abyx-status-pill error" title="Folder path not found on disk">
                      <AlertTriangle size={11} />
                      <span>Missing</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="project-card-path" title={ws.path}>
                <code>{ws.path}</code>
              </div>

              <div className="project-card-footer">
                <div className="project-card-actions">
                  {!isActive ? (
                    <button
                      type="button"
                      className="abyx-btn abyx-btn-sm abyx-btn-secondary"
                      onClick={() => handleSwitchProject(ws.id)}
                      disabled={!ws.available}
                      title={ws.available ? "Set as active workspace" : "Folder missing on disk"}
                    >
                      <FolderCheck size={14} />
                      <span>Activate</span>
                    </button>
                  ) : (
                    <span className="current-badge-text">In Use</span>
                  )}
                  <button
                    type="button"
                    className="abyx-btn abyx-btn-sm abyx-btn-ghost"
                    onClick={() => handleOpenInExplorer(ws)}
                    title="Open in Windows Explorer"
                  >
                    <ExternalLink size={14} />
                  </button>
                  {workspaces.length > 1 && (
                    <button
                      type="button"
                      className="abyx-btn abyx-btn-sm abyx-btn-ghost danger"
                      onClick={() => handleDeleteProject(ws)}
                      title="Remove project from list"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Security & Boundary Notice */}
      <div className="abyx-security-notice-card">
        <div className="security-notice-icon">
          <ShieldCheck size={22} />
        </div>
        <div className="security-notice-body">
          <h4 className="notice-title">Workspace Boundary Guarantee</h4>
          <p className="notice-text">
            All AI file operations (create, read, write, edit, and search) are strictly constrained to the active project folder.
            Path traversal (<code>../</code>), symlink escapes, and access to system directories or credentials (<code>.env</code>, <code>credentials.json</code>, DPAPI vault) are unconditionally rejected with security violations.
          </p>
        </div>
      </div>

      {/* Active Project Files Explorer */}
      {activeProject && (
        <div className="abyx-files-section">
          <div className="files-section-header">
            <div className="files-header-left">
              <h3 className="section-title">Files in Workspace: {activeProject.name}</h3>
              <div className="files-breadcrumb">
                <span>Folder: <code>{activeProject.path}</code></span>
              </div>
            </div>
            <div className="files-header-right">
              {/* File Search */}
              <form onSubmit={handleSearchFiles} className="file-search-form">
                <Search size={15} className="file-search-icon" />
                <input
                  type="text"
                  placeholder="Search project files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="file-search-input"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="file-search-clear"
                    onClick={() => {
                      setSearchQuery("");
                      setSearchResults(null);
                    }}
                  >
                    <X size={13} />
                  </button>
                )}
              </form>

              <button
                type="button"
                className="abyx-btn abyx-btn-sm abyx-btn-primary"
                onClick={() => {
                  setNewFileError(null);
                  setNewFileModalOpen(true);
                }}
              >
                <Plus size={14} />
                <span>New File</span>
              </button>
            </div>
          </div>

          {/* Search Results Display */}
          {searchResults && (
            <div className="search-results-banner">
              <div className="search-results-title">
                <span>Search results for "{searchQuery}" ({searchResults.length} matches):</span>
                <button
                  type="button"
                  className="abyx-btn abyx-btn-xs abyx-btn-ghost"
                  onClick={() => setSearchResults(null)}
                >
                  Clear Results
                </button>
              </div>
              <div className="search-results-list">
                {searchResults.length === 0 ? (
                  <div className="search-empty">No files or contents matched "{searchQuery}"</div>
                ) : (
                  searchResults.map((match, idx) => (
                    <div
                      key={idx}
                      className="search-result-item"
                      onClick={() => handleOpenFile({ path: match.path, name: match.path })}
                    >
                      <FileCode size={14} />
                      <span className="search-result-path">{match.path}</span>
                      <span className="search-result-type">[{match.matchType}]</span>
                      {match.snippet && <code className="search-result-snippet">"{match.snippet}"</code>}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Files List / Table */}
          <div className="abyx-files-table-container">
            {filesLoading ? (
              <div className="files-loading-state">
                <RefreshCw size={20} className="abyx-spin" />
                <span>Loading workspace files...</span>
              </div>
            ) : files.length === 0 ? (
              <div className="files-empty-state">
                <Folder size={32} />
                <p>This project folder is empty.</p>
                <button
                  type="button"
                  className="abyx-btn abyx-btn-sm abyx-btn-primary"
                  onClick={() => setNewFileModalOpen(true)}
                >
                  <Plus size={14} />
                  <span>Create First File</span>
                </button>
              </div>
            ) : (
              <table className="abyx-files-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th>Modified</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((item, idx) => (
                    <tr key={idx} className="file-row">
                      <td className="file-name-cell" onClick={() => item.type === "file" && handleOpenFile(item)}>
                        <div className="file-name-wrap">
                          {item.type === "directory" ? (
                            <Folder size={16} className="file-icon-dir" />
                          ) : (
                            <FileText size={16} className="file-icon-file" />
                          )}
                          <span className="file-item-name">{item.name}</span>
                        </div>
                      </td>
                      <td className="file-meta-cell">
                        <span className="file-type-tag">{item.type}</span>
                      </td>
                      <td className="file-meta-cell">
                        {item.type === "file" ? formatBytes(item.sizeBytes) : "—"}
                      </td>
                      <td className="file-meta-cell">
                        {item.modified ? new Date(item.modified).toLocaleDateString() : "—"}
                      </td>
                      <td className="file-actions-cell">
                        {item.type === "file" && (
                          <button
                            type="button"
                            className="abyx-btn-icon"
                            onClick={() => handleOpenFile(item)}
                            title="View / Edit file"
                          >
                            <Eye size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="abyx-btn-icon danger"
                          onClick={() => handleDeleteFile(item.path || item.name)}
                          title="Delete file"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Modal: Create Project */}
      {createModalOpen && (
        <div className="abyx-modal-backdrop" onClick={() => setCreateModalOpen(false)}>
          <div className="abyx-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="abyx-modal-header">
              <div className="abyx-modal-title-row">
                <FolderPlus size={20} />
                <h3>Create New Project</h3>
              </div>
              <button
                type="button"
                className="abyx-modal-close"
                onClick={() => setCreateModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="abyx-modal-body">
              {createError && (
                <div className="abyx-alert abyx-alert-error">
                  <AlertTriangle size={15} />
                  <span>{createError}</span>
                </div>
              )}

              <div className="abyx-form-group">
                <label className="abyx-form-label">Project Name</label>
                <input
                  type="text"
                  className="abyx-input"
                  placeholder="e.g. AI Duolingo, Web App, Research"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="abyx-form-group">
                <label className="abyx-form-label">Project Folder on PC (Optional)</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    className="abyx-input"
                    placeholder="e.g. C:\Users\Username\Projects\MyProject (or leave empty to create default)"
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="abyx-btn abyx-btn-secondary"
                    onClick={handleBrowseNativeFolder}
                    title="Browse PC folders"
                  >
                    <FolderOpen size={16} />
                    <span>Browse</span>
                  </button>
                </div>
                <span className="abyx-form-hint">
                  If the folder does not exist, it will be automatically created on your PC.
                </span>
              </div>

              <div className="abyx-modal-footer">
                <button
                  type="button"
                  className="abyx-btn abyx-btn-secondary"
                  onClick={() => setCreateModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="abyx-btn abyx-btn-primary"
                  disabled={createSubmitting}
                >
                  {createSubmitting ? "Creating..." : "Create Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: View / Edit File */}
      {selectedFile && (
        <div className="abyx-modal-backdrop" onClick={() => setSelectedFile(null)}>
          <div className="abyx-modal-card wide" onClick={(e) => e.stopPropagation()}>
            <div className="abyx-modal-header">
              <div className="abyx-modal-title-row">
                <FileCode size={20} />
                <div>
                  <h3 style={{ margin: 0 }}>{selectedFile.name}</h3>
                  <code style={{ fontSize: "11px", color: "var(--text-muted, #a1a1aa)" }}>
                    {selectedFile.path || selectedFile.name}
                  </code>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  className={`abyx-btn abyx-btn-xs ${fileEditMode ? "abyx-btn-primary" : "abyx-btn-secondary"}`}
                  onClick={() => setFileEditMode(!fileEditMode)}
                >
                  <Edit3 size={12} />
                  <span>{fileEditMode ? "View Mode" : "Edit Mode"}</span>
                </button>
                <button
                  type="button"
                  className="abyx-modal-close"
                  onClick={() => setSelectedFile(null)}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="abyx-modal-body">
              {fileActionError && (
                <div className="abyx-alert abyx-alert-error">
                  <AlertTriangle size={15} />
                  <span>{fileActionError}</span>
                </div>
              )}
              {fileActionSuccess && (
                <div className="abyx-alert abyx-alert-success">
                  <CheckCircle2 size={15} />
                  <span>{fileActionSuccess}</span>
                </div>
              )}

              {fileLoading ? (
                <div className="files-loading-state">
                  <RefreshCw size={20} className="abyx-spin" />
                  <span>Loading file content...</span>
                </div>
              ) : fileEditMode ? (
                <div className="file-editor-container">
                  <textarea
                    className="file-editor-textarea"
                    value={fileContent}
                    onChange={(e) => setFileContent(e.target.value)}
                    rows={16}
                    placeholder="File content..."
                  />

                  {/* Surgical Find & Replace Section */}
                  <div className="surgical-replace-box">
                    <h5 className="surgical-title">Surgical Find & Replace</h5>
                    <form onSubmit={handleSurgicalReplace} className="surgical-form">
                      <input
                        type="text"
                        className="abyx-input"
                        placeholder="Target text snippet to find..."
                        value={replaceTarget}
                        onChange={(e) => setReplaceTarget(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <input
                        type="text"
                        className="abyx-input"
                        placeholder="Replacement text..."
                        value={replaceReplacement}
                        onChange={(e) => setReplaceReplacement(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="submit"
                        className="abyx-btn abyx-btn-secondary"
                        disabled={fileSaving || !replaceTarget}
                      >
                        Replace
                      </button>
                    </form>
                  </div>
                </div>
              ) : (
                <pre className="file-viewer-pre">
                  <code>{fileContent}</code>
                </pre>
              )}
            </div>

            <div className="abyx-modal-footer">
              <button
                type="button"
                className="abyx-btn abyx-btn-secondary"
                onClick={() => setSelectedFile(null)}
              >
                Close
              </button>
              {fileEditMode && (
                <button
                  type="button"
                  className="abyx-btn abyx-btn-primary"
                  onClick={handleSaveFileContent}
                  disabled={fileSaving}
                >
                  {fileSaving ? "Saving..." : "Save File"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: New File */}
      {newFileModalOpen && (
        <div className="abyx-modal-backdrop" onClick={() => setNewFileModalOpen(false)}>
          <div className="abyx-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="abyx-modal-header">
              <div className="abyx-modal-title-row">
                <FileText size={20} />
                <h3>Create New File in Workspace</h3>
              </div>
              <button
                type="button"
                className="abyx-modal-close"
                onClick={() => setNewFileModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateNewFile} className="abyx-modal-body">
              {newFileError && (
                <div className="abyx-alert abyx-alert-error">
                  <AlertTriangle size={15} />
                  <span>{newFileError}</span>
                </div>
              )}

              <div className="abyx-form-group">
                <label className="abyx-form-label">Filename</label>
                <input
                  type="text"
                  className="abyx-input"
                  placeholder="e.g. index.html, main.py, notes.md"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="abyx-form-group">
                <label className="abyx-form-label">Initial Content (Optional)</label>
                <textarea
                  className="abyx-input"
                  placeholder="Write initial content here..."
                  value={newFileContent}
                  onChange={(e) => setNewFileContent(e.target.value)}
                  rows={8}
                />
              </div>

              <div className="abyx-modal-footer">
                <button
                  type="button"
                  className="abyx-btn abyx-btn-secondary"
                  onClick={() => setNewFileModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="abyx-btn abyx-btn-primary"
                  disabled={newFileSubmitting}
                >
                  {newFileSubmitting ? "Creating..." : "Create File"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
