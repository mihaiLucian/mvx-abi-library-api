import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

@Injectable()
export class RequestBodyValidationPipe<T> implements PipeTransform<any> {
  private readonly metatype: any;

  constructor(metatype: any) {
    this.metatype = metatype;
  }

  async transform(value: any): Promise<T> {
    // Check if the value is an empty object
    if (
      value &&
      Object.keys(value).length === 0 &&
      value.constructor === Object
    ) {
      throw new BadRequestException('Body should not be an empty object');
    }

    // Check if the value is an array
    if (Array.isArray(value)) {
      const objects = value.map((item) => plainToInstance(this.metatype, item));
      const errors = await Promise.all(
        objects.map((obj) => {
          return validate(obj, {
            whitelist: true,
            forbidNonWhitelisted: true,
            enableDebugMessages: true,
            stopAtFirstError: true,
          });
        }),
      );

      errors.forEach((error, index) => {
        if (error.length > 0) {
          const errorMessage = this.formatErrorMessage(error, value[index]);
          throw new BadRequestException(errorMessage);
        }
      });

      const flattenedErrors = errors.flat();
      if (flattenedErrors.length > 0) {
        const errorMessage = this.formatErrorMessage(flattenedErrors, value);
        throw new BadRequestException(errorMessage);
      }

      return objects as T;
    } else {
      const object = plainToInstance(this.metatype, value);
      const errors = await validate(object, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      if (errors.length > 0) {
        const errorMessage = this.formatErrorMessage(errors, value);
        throw new BadRequestException(errorMessage);
      }

      return object as T;
    }
  }

  private formatErrorMessage(errors: any[], originalValue: any): string {
    const flattenErrors = (errors: any[], parentPath = ''): string[] => {
      return errors.reduce((acc, error) => {
        const propertyPath = parentPath
          ? `${parentPath}.${error.property}`
          : error.property;
        const propertyValue = this.getPropertyValue(
          originalValue,
          propertyPath,
        );
        if (error.constraints) {
          acc.push(
            ...Object.entries(error.constraints).map(
              ([constraint, message]) =>
                `${propertyPath} (value: ${propertyValue !== undefined ? propertyValue : 'undefined'}): ${message}`,
            ),
          );
        }
        if (error.children && error.children.length) {
          acc.push(...flattenErrors(error.children, propertyPath));
        }
        return acc;
      }, [] as string[]);
    };

    return flattenErrors(errors).join('; ');
  }

  private getPropertyValue(obj: any, path: string): any {
    return path.split('.').reduce((acc, part) => {
      if (Array.isArray(acc)) {
        const index = parseInt(part, 10);
        return acc[index];
      }
      return acc && acc[part];
    }, obj);
  }
}
