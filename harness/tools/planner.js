/**
 * Planner Tool
 * Manages the canonical `.agents_tmp/PLAN.md` file for task roadmap, current stage, and progress reporting.
 */

const fs = require('node:fs');
const path = require('node:path');

class PlannerTool {
  constructor(workspaceDir = process.cwd()) {
    this.name = 'planner';
    this.description = 'Creates, updates, and reads the canonical plan file (.agents_tmp/PLAN.md).';
    this.workspaceDir = workspaceDir;
    this.planDir = path.join(this.workspaceDir, '.agents_tmp');
    this.planFile = path.join(this.planDir, 'PLAN.md');
  }

  getSchema() {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create_plan', 'update_plan', 'get_plan', 'mark_step'],
          description: 'Planner action'
        },
        title: { type: 'string', description: 'Plan title or objective' },
        steps: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of step descriptions'
        },
        currentStep: { type: 'integer', description: '1-based index of current step' },
        notes: { type: 'string', description: 'Additional progress notes' }
      },
      required: ['action']
    };
  }

  async execute(args) {
    const { action, title, steps, currentStep, notes } = args;

    if (!fs.existsSync(this.planDir)) {
      fs.mkdirSync(this.planDir, { recursive: true });
    }

    switch (action) {
      case 'create_plan': {
        const stepList = steps && steps.length > 0 ? steps : ['Initial assessment', 'Execution', 'Verification'];
        const contentLines = [
          `# Plan: ${title || 'Agent Execution Plan'}`,
          `*Created: ${new Date().toISOString()}*`,
          '',
          '## Steps',
          ...stepList.map((s, idx) => `- [${idx === 0 ? 'x' : ' '}] Step ${idx + 1}: ${s}`),
          '',
          '## Notes',
          notes || 'Initial plan created.'
        ];
        fs.writeFileSync(this.planFile, contentLines.join('\n'), 'utf8');
        return { status: 'created', path: this.planFile, stepCount: stepList.length };
      }

      case 'update_plan': {
        let content = '';
        if (fs.existsSync(this.planFile)) {
          content = fs.readFileSync(this.planFile, 'utf8');
        }
        if (notes) {
          content += `\n\n### Update (${new Date().toLocaleTimeString()}):\n${notes}`;
        }
        fs.writeFileSync(this.planFile, content, 'utf8');
        return { status: 'updated', path: this.planFile };
      }

      case 'mark_step': {
        if (!fs.existsSync(this.planFile)) {
          return { error: 'No PLAN.md file found to update' };
        }
        let content = fs.readFileSync(this.planFile, 'utf8');
        const targetStep = currentStep || 1;
        // Replace Step targetStep checkbox
        const regex = new RegExp(`- \\[ \\] Step ${targetStep}:`, 'g');
        content = content.replace(regex, `- [x] Step ${targetStep}:`);
        fs.writeFileSync(this.planFile, content, 'utf8');
        return { status: 'step_marked', step: targetStep };
      }

      case 'get_plan': {
        if (!fs.existsSync(this.planFile)) {
          return { exists: false, content: null };
        }
        const content = fs.readFileSync(this.planFile, 'utf8');
        return { exists: true, path: this.planFile, content };
      }

      default:
        return { error: `Unknown planner action: ${action}` };
    }
  }
}

module.exports = { PlannerTool };
