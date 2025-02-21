import { AI_PROMPT_TEMPLATES } from './prompt-templates';
import * as Mustache from 'mustache';

export class PromptGenerator {
  static renderTemplate(
    templateName: string,
    data: Record<string, any>,
  ): string {
    const template = AI_PROMPT_TEMPLATES[templateName];
    if (!template) {
      throw new Error(`Template ${templateName} not found`);
    }
    return Mustache.render(template, data);
  }
}
