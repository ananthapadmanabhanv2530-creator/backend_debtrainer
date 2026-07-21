import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { ValidationError } from '../utils/errors';

export const validate = (schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const errorMessages = result.error.errors.map((e) => e.message).join(', ');
      return next(new ValidationError(errorMessages));
    }

    req[source] = result.data;
    next();
  };
};
