export declare const isFunction: (arg: unknown) => arg is (...args: any[]) => any;
export declare const isRegExp: (arg: unknown) => arg is RegExp;
export declare function readAllFile(root: string, reg?: RegExp): string[];
