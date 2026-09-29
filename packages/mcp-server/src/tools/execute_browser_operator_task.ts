import {
  compileBrowserOperatorTask,
  type BrowserOperatorTaskInput,
} from '../core/index.js';
import {
  ExecuteBrowserOperatorTaskInputSchema,
  type ExecuteBrowserOperatorTaskInput,
} from '../schemas/index.js';

export const executeBrowserOperatorTaskTool = {
  name: 'execute_browser_operator_task',
  description:
    'Compila y orquesta tareas de navegación web autónoma para conciliación bancaria y extracción de estados de cuenta (Banesco Panamá, Facebank, Simly).',
  inputSchema: ExecuteBrowserOperatorTaskInputSchema,
  execute: (input: ExecuteBrowserOperatorTaskInput) => {
    const compiledTask = compileBrowserOperatorTask({
      targetSite: input.targetSite,
      action: input.action,
      referenceToVerify: input.referenceToVerify,
      expectedAmount: input.expectedAmount,
      headless: input.headless,
    });

    return {
      success: true,
      compiledTask,
      executionStatus: 'TASK_COMPILED_READY_FOR_AGENT_RUNNER',
      evaluatedAt: new Date().toISOString(),
    };
  },
};
