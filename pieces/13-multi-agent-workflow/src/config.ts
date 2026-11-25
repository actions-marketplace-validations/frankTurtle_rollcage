import { parseYamlConfig } from '@adl/shared';
import { z } from 'zod';

export const ConfigSchema = z.object({
  agents_dir: z.string().default('agents'),
  /** Branches a commit may land on without approval. Everything else is shared. */
  agent_branches: z.array(z.string()).default(['agent/*']),
  max_rework_rounds: z.number().int().min(0).default(1),
  max_steps: z.number().int().min(1).default(8),
});

export type WorkflowConfig = z.infer<typeof ConfigSchema>;

export const loadConfig = (yamlText?: string): WorkflowConfig =>
  parseYamlConfig(ConfigSchema, yamlText);
