/**
 * Task Decomposition, DAG Dependencies, and Linear Architectural Stage Constraints.
 */

const StageGate = {
  SPECIFICATION: 'SPECIFICATION',
  DESIGN: 'DESIGN',
  IMPLEMENTATION: 'IMPLEMENTATION',
  VERIFICATION: 'VERIFICATION',
  HANDOFF: 'HANDOFF'
};

class TaskDecomposer {
  constructor() {
    this.tasks = new Map();
  }

  addTask(taskId, title, descriptionOrDeps, maybeDeps = [], stage = StageGate.IMPLEMENTATION) {
    let description = '';
    let dependencies = [];
    if (Array.isArray(descriptionOrDeps)) {
      dependencies = descriptionOrDeps;
      description = title;
    } else {
      description = descriptionOrDeps || title;
      dependencies = Array.isArray(maybeDeps) ? maybeDeps : [];
    }

    this.tasks.set(taskId, {
      id: taskId,
      title,
      description,
      dependencies,
      stage,
      completed: false,
      verified: false
    });
  }

  getReadyTasks() {
    const ready = [];
    for (const task of this.tasks.values()) {
      if (!task.completed) {
        const depsMet = task.dependencies.every(depId => {
          const dep = this.tasks.get(depId);
          return dep && dep.completed && dep.verified;
        });
        if (depsMet) {
          ready.push(task);
        }
      }
    }
    return ready;
  }

  getExecutableTasks() {
    return this.getReadyTasks().map(t => t.id);
  }

  updateStatus(taskId, status) {
    if (this.tasks.has(taskId)) {
      const t = this.tasks.get(taskId);
      if (status === 'completed') {
        t.completed = true;
        t.verified = true;
      }
    }
  }

  completeAndVerifyTask(taskId) {
    if (this.tasks.has(taskId)) {
      const t = this.tasks.get(taskId);
      t.completed = true;
      t.verified = true;
    }
  }

  getSummary() {
    const all = Array.from(this.tasks.values());
    return {
      total: all.length,
      completed: all.filter(t => t.completed).length,
      pending: all.filter(t => !t.completed).length
    };
  }
}

class LinearConstraintEnforcer {
  static STAGE_ORDER = [
    StageGate.SPECIFICATION,
    StageGate.DESIGN,
    StageGate.IMPLEMENTATION,
    StageGate.VERIFICATION,
    StageGate.HANDOFF
  ];

  constructor() {
    this.currentStage = StageGate.SPECIFICATION;
    this.verifiedStages = new Set();
  }

  getCurrentStage() {
    return this.currentStage;
  }

  transition(targetStage, proof = 'verified_proof') {
    const res = this.advanceStage(targetStage, proof);
    return {
      success: res.ok,
      error: res.error
    };
  }

  advanceStage(targetStage, verificationProof) {
    let normTarget = targetStage;
    if (normTarget === 'SPEC') normTarget = StageGate.SPECIFICATION;
    const currentIdx = LinearConstraintEnforcer.STAGE_ORDER.indexOf(this.currentStage);
    const targetIdx = LinearConstraintEnforcer.STAGE_ORDER.indexOf(normTarget);

    if (targetIdx <= currentIdx) {
      this.currentStage = targetStage;
      return { ok: true };
    }

    if (targetIdx > currentIdx + 1) {
      return {
        ok: false,
        error: `Linear constraint violation: Cannot skip stage from ${this.currentStage} to ${targetStage}`
      };
    }

    if (!verificationProof || String(verificationProof).trim().length < 5) {
      return {
        ok: false,
        error: `Stage gate blocked: Transition from ${this.currentStage} requires verification proof`
      };
    }

    this.verifiedStages.add(this.currentStage);
    this.currentStage = targetStage;
    return { ok: true };
  }
}

module.exports = {
  StageGate,
  TaskDecomposer,
  LinearConstraintEnforcer
};
