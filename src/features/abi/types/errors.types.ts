export class AbiWarpGeneratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbiWarpGeneratorError';
  }
}

export class InvalidInputError extends AbiWarpGeneratorError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

export class InvalidTypeError extends AbiWarpGeneratorError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTypeError';
  }
}
