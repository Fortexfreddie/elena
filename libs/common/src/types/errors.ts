export class ElenaError extends Error {
    public readonly code: string;
    public readonly statusCode: number;

    constructor(message: string, code: string, statusCode: number) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.statusCode = statusCode;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class ValidationError extends ElenaError {
    constructor(message: string) {
        super(message, 'VALIDATION_ERROR', 400);
    }
}

export class DatabaseError extends ElenaError {
    constructor(message: string) {
        super(message, 'DATABASE_ERROR', 500);
    }
}

export class MemoryError extends ElenaError {
    constructor(message: string) {
        super(message, 'MEMORY_ERROR', 500);
    }
}

export class ModelError extends ElenaError {
    constructor(message: string) {
        super(message, 'MODEL_ERROR', 502);
    }
}

export class ToolError extends ElenaError {
    constructor(message: string) {
        super(message, 'TOOL_ERROR', 500);
    }
}

export class SafetyError extends ElenaError {
    constructor(message: string) {
        super(message, 'SAFETY_ERROR', 403);
    }
}

export class AuthError extends ElenaError {
    constructor(message: string) {
        super(message, 'AUTH_ERROR', 401);
    }
}
