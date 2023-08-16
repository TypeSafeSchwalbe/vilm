
const Vilm = (() => {

    function Source(file, start, end) { return { file, start, end }; }

    function throwError(message, tokens) {
        throw "(from Vilm) " + generateErrorMessage(message, tokens);
    }

    function generateErrorMessage(message, tokens) {
        let source = null;
        if(tokens instanceof Array && tokens.length > 0 && typeof tokens[0].source.file === "object" && typeof tokens[0].source.start === "number" && typeof tokens[tokens.length - 1].source.end === "number") {
            source = Source(tokens[0].source.file, tokens[0].source.start, tokens[tokens.length - 1].source.end);
        } else if(typeof tokens.source.file === "object" && typeof tokens.source.start === "number" && typeof tokens.source.end === "number") {
            source = tokens.source;
        }
        let output = `[error] ${message}`;
        if(source !== null) {
            const startLine = source.file.content.slice(0, source.start).split("\n").length - 1;
            const endLine = source.file.content.slice(0, source.end).split("\n").length - 1;
            const inText = `―[in '${source.file.name}' on line ${startLine + 1}]―――――――――――――――――――――`;
            output += "\n" + inText;
            let line = 0;
            let lineMarkings = "";
            const MARKING = '^';
            for(let char = 0; char < source.file.content.length; char += 1) {
                if(source.file.content[char] === "\n") {
                    if(lineMarkings.includes(MARKING)) { output += "\n" + lineMarkings; }
                    lineMarkings = "";
                    line += 1
                }
                if(line >= startLine - 2 && line <= endLine + 2) {
                    output += source.file.content[char];
                    if(source.file.content[char] !== "\n") {
                        lineMarkings += char >= source.start && char < source.end? MARKING : " ";
                    }
                }
            }
            output += "\n" + "―".repeat(inText.length);
        }
        return output;
    }


    const lexer = {
        file: null,
        chars: null,
        i: 0,
        discard: false
    };

    const TokenType = {
        Whitespace: () => {
            if(lexer.chars[lexer.i].trim().length !== 0) { throw ""; }
            while(lexer.i < lexer.chars.length && lexer.chars[lexer.i].trim().length === 0) { lexer.i += 1; }
            lexer.discard = true;
        },
        LineComment: () => {
            if(lexer.chars[lexer.i] !== "#") { throw ""; }
            while(lexer.chars[lexer.i] !== "\n") { lexer.i += 1; }
            lexer.discard = true;
        },
        Number: () => {
            const NUMBERS = "0123456789";
            if(!NUMBERS.includes(lexer.chars[lexer.i])) { throw ""; }
            while(NUMBERS.includes(lexer.chars[lexer.i])) { lexer.i += 1; }
            if(lexer.chars[lexer.i] === ".") {
                lexer.i += 1;
                if(!NUMBERS.includes(lexer.chars[lexer.i])) { throw ""; }
                while(NUMBERS.includes(lexer.chars[lexer.i])) { lexer.i += 1; }
            }
        },
        ParenOpen: "(",
        ParenClose: ")",
        BraceOpen: "{",
        BraceClose: "}",
        String: () => {
            if(lexer.chars[lexer.i] !== '"') { throw ""; }
            const start = lexer.i;
            lexer.i += 1;
            let escaped = false;
            while(escaped || lexer.chars[lexer.i] !== '"') {
                if(lexer.i >= lexer.chars.length) {
                    throwError("unclosed string literal", Token(TokenType.String, lexer.chars.slice(start, lexer.i), Source(lexer.file, start, lexer.i)));
                }
                escaped = lexer.chars[lexer.i] === "\\";
                lexer.i += 1;
            }
            lexer.i += 1;
        },
        Other: () => {
            const NON_OTHER_CHARS = "(){}";
            if(lexer.chars[lexer.i].trim().length === 0 || NON_OTHER_CHARS.includes(lexer.chars[lexer.i])) { throw ""; }
            while(lexer.chars[lexer.i].trim().length !== 0 && !NON_OTHER_CHARS.includes(lexer.chars[lexer.i])) { lexer.i += 1; }
        }
    };

    function Token(type, content, source) { return { type, content, source }; }

    function tokenize(source, file) {
        source += "\n";
        let tokens = [];
        lexer.file = file;
        lexer.chars = source;
        lexer.i = 0;
        while(lexer.i < source.length) {
            let start = lexer.i;
            let tokenized = false;
            for(const tokenType of Object.values(TokenType)) {
                lexer.i = start;
                lexer.discard = false;
                try {
                    if(typeof tokenType === "function") {
                        tokenType();
                    } else {
                        for(let c = 0; c < tokenType.length; c += 1) {
                            if(lexer.chars[lexer.i] != tokenType[c]) { throw ""; }
                            lexer.i += 1;
                        }
                    }
                    if(!lexer.discard) {
                        tokens.push(Token(tokenType, source.slice(start, lexer.i), Source(file, start, lexer.i)));
                    }
                    tokenized = true;
                    break;
                } catch(err) {
                    if(typeof err === "string" && err.length > 0) { throw err; }
                }
            }
            if(!tokenized && lexer.i < source.length) {
                throwError(`encounterd an invalid character: '${lexer.chars[lexer.i]}'`, Token(null, source.slice(lexer.i, lexer.i + 1), Source(file, lexer.i, lexer.i + 1)));
            }
        }
        return tokens;
    }


    const Signal = {
        None: "Signal.None",
        Continue: "Signal.Continue",
        Break: "Signal.Break",
        Return: "Signal.Return"
    };

    class ScopeInfo {
        constructor(parentScope) {
            this.parentScope = typeof parentScope === "undefined"? null : parentScope;
            this.variables = {};
            this.tokens = [];

            this.index = 0;
            this.signal = Signal.None;

            this.returned = null;
        }
    }

    class Vilm {

        constructor() {
            this.fileQueue = [];
            this.packages = new Map();
            this.currentPackage = this._getPackage("");

            this._addDefaults();
        }

        _getPackage(name) {
            if(this.packages.has(name)) { return this.packages.get(name); }
            const newPackage = {
                coreMacros: new Map(),
                jsFunctions: new Map(),
                macros: new Map(),
                functions: new Map()
            };
            this.packages.set(name, newPackage);
            return newPackage;
        }

        _includeBase() {
            const basePackage = this._getPackage("");
            for(const name of basePackage.coreMacros.keys()) { this.currentPackage.coreMacros.set(name, basePackage.coreMacros.get(name)); }
            for(const name of basePackage.jsFunctions.keys()) { this.currentPackage.jsFunctions.set(name, basePackage.jsFunctions.get(name)); }
            for(const name of basePackage.macros.keys()) { this.currentPackage.macros.set(name, basePackage.macros.get(name)); }
            for(const name of basePackage.functions.keys()) { this.currentPackage.functions.set(name, basePackage.functions.get(name)); }
        } 

        _addCoreMacro(name, argCount, handler) { this.currentPackage.coreMacros.set(name, { argCount, handler }); }
        _addJsFunction(name, argCount, jsFunction) { this.currentPackage.jsFunctions.set(name, { argCount, jsFunction}); }
        _addMacro(name, argNames, body, parentScope) { this.currentPackage.macros.set(name, { argNames, body, parentScope, declaredIn: this.currentPackage }); }
        _addFunction(name, argNames, body, parentScope) { this.currentPackage.functions.set(name, { argNames, body, parentScope, declaredIn: this.currentPackage }); }

        _addDefaults() {
            this._addCoreMacro("pkg", 1, (scopeInfo, name) => {
                if(name.length !== 1 || name[0].type !== TokenType.Other) {
                    throwError("the provided package name is not an identifier", name);
                }
                const isNew = !this.packages.has(name[0].content);
                this.currentPackage = this._getPackage(name[0].content);
                if(isNew) { this._includeBase(); }
                return null;
            });
            this._addCoreMacro("useall", 1, (scopeInfo, packageName) => {
                if(packageName.length !== 1 || packageName[0].type !== TokenType.Other) {
                    throwError("the provided package name is not an identifier", packageName);
                }
                if(!this.packages.has(packageName[0].content)) {
                    throwError(`no package with the name '${packageName[0].content}' has been defined up to this point`, packageName);
                }
                const importPackage = this._getPackage(packageName[0].content);
                for(const name of importPackage.coreMacros.keys()) { this.currentPackage.coreMacros.set(name, importPackage.coreMacros.get(name)); }
                for(const name of importPackage.jsFunctions.keys()) { this.currentPackage.jsFunctions.set(name, importPackage.jsFunctions.get(name)); }
                for(const name of importPackage.macros.keys()) { this.currentPackage.macros.set(name, importPackage.macros.get(name)); }
                for(const name of importPackage.functions.keys()) { this.currentPackage.functions.set(name, importPackage.functions.get(name)); }
                return null;
            });
            this._addCoreMacro("use", 2, (scopeInfo, packageName, name) => {
                if(packageName.length !== 1 || packageName[0].type !== TokenType.Other) {
                    throwError("the provided package name is not an identifier", packageName);
                }
                if(!this.packages.has(packageName[0].content)) {
                    throwError(`no package with the name '${packageName[0].content}' has been defined up to this point`, packageName);
                }
                const importPackage = this._getPackage(packageName[0].content);
                const imported = name[0].type === TokenType.ParenOpen?
                    this._parseTokenArray(name) :
                    name.length === 1? [name] : null;
                if(imported === null) {
                    throwError(`the imported items are not a single identifier or an array of single identifiers`, name);
                }
                for(const name of imported) {
                    if(name.length !== 1 || name[0].type !== TokenType.Other) {
                        throwError(`one of the imported items is not a single identifier`, name);
                    }
                    if(importPackage.coreMacros.has(name[0].content)) { this.currentPackage.coreMacros.set(name[0].content, importPackage.coreMacros.get(name[0].content)); }
                    else if(importPackage.jsFunctions.has(name[0].content)) { this.currentPackage.jsFunctions.set(name[0].content, importPackage.jsFunctions.get(name[0].content)); }
                    else if(importPackage.macros.has(name[0].content)) { this.currentPackage.macros.set(name[0].content, importPackage.macros.get(name[0].content)); }
                    else if(importPackage.functions.has(name[0].content)) { this.currentPackage.functions.set(name[0].content, importPackage.functions.get(name[0].content)); }
                    else {
                        throwError(`the package '${packageName[0].content}' does not contain a function or macro called '${name[0].content}'`, name);
                    }
                }
                return null;
            });

            this._addCoreMacro("macro", 3, (scopeInfo, name, argNames, body) => {
                if(name.length !== 1 || name[0].type !== TokenType.Other) {
                    throwError("the provided macro name is not an identifier", name);
                }
                let argNamesParsed = this._parseTokenArray(argNames);
                if(argNamesParsed === null) {
                    throwError("the parameter list is not an array of single identifiers", argNames);
                }
                argNamesParsed = argNamesParsed.map((name) => {
                    if(name.length !== 1 || name[0].type !== TokenType.Other) {
                        throwError("one of the parameter names is not a single identifier", name);
                    }
                    return name[0].content;
                });
                if(body[0].type === TokenType.ParenOpen) { body = body.slice(1, body.length - 1); }
                this._addMacro(name[0].content, argNamesParsed, body, scopeInfo);
                return null;
            });
            this._addCoreMacro("func", 3, (scopeInfo, name, argNames, body) => {
                if(name.length !== 1 || name[0].type !== TokenType.Other) {
                    throwError("the provided macro name is not an identifier", name);
                }
                let argNamesParsed = this._parseTokenArray(argNames);
                if(argNamesParsed === null) {
                    throwError("the parameter list is not an array of single identifiers", argNames);
                }
                argNamesParsed = argNamesParsed.map((name) => {
                    if(name.length !== 1 || name[0].type !== TokenType.Other) {
                        throwError("one of the parameter names is not a single identifier", name);
                    }
                    return name[0].content;
                });
                if(body[0].type === TokenType.ParenOpen) { body = body.slice(1, body.length - 1); }
                this._addFunction(name[0].content, argNamesParsed, body, scopeInfo);
                return null;
            });
            this._addCoreMacro("vfunc", 2, (scopeInfo, name, body) => {
                if(name.length !== 1 || name[0].type !== TokenType.Other) {
                    throwError("the provided macro name is not an identifier", name);
                }
                const evalScopeInfo = new ScopeInfo(scopeInfo);
                evalScopeInfo.tokens = body;
                const jsFunction = this._executeTokens(evalScopeInfo);
                if(typeof jsFunction !== "function") {
                    throwError("the provided function value is not a function", body);
                }
                if(evalScopeInfo.signal !== Signal.None) {
                    scopeInfo.signal = evalScopeInfo.signal;
                    scopeInfo.returned = evalScopeInfo.returned;
                    return null;
                }
                this._addJsFunction(name[0].content, jsFunction.length, jsFunction);
                return null;
            });
            this._addCoreMacro("lambda", 2, (scopeInfo, argNames, body) => {
                let argNamesParsed = this._parseTokenArray(argNames);
                if(argNamesParsed === null) {
                    throwError("the parameter list is not an array of single identifiers", argNames);
                }
                argNamesParsed = argNamesParsed.map((name) => {
                    if(name.length !== 1 || name[0].type !== TokenType.Other) {
                        throwError("one of the parameter names is not a single identifier", name);
                    }
                    return name[0].content;
                });
                if(body[0].type === TokenType.ParenOpen) { body = body.slice(1, body.length - 1); }
                return (...argValues) => {
                    if(argValues.length !== argNamesParsed.length) {
                        throwError(`lambda takes ${argNamesParsed.length} parameters, but ${argValues.length} were provided`, argNames);
                    }
                    const bodyScopeInfo = new ScopeInfo(scopeInfo);
                    bodyScopeInfo.tokens = body;
                    for(let argIndex = 0; argIndex < argValues.length; argIndex += 1) {
                        bodyScopeInfo.variables[argNamesParsed[argIndex]] = argValues[argIndex];
                    }
                    return this._executeBlock(bodyScopeInfo, [Signal.Return]);
                };
            });

            this._addCoreMacro("if", 2, (scopeInfo, condition, body) => {
                const evalScopeInfo = new ScopeInfo(scopeInfo);
                evalScopeInfo.tokens = condition;
                const conditionVal = this._executeTokens(evalScopeInfo);
                if(evalScopeInfo.signal !== Signal.None) {
                    scopeInfo.signal = evalScopeInfo.signal;
                    scopeInfo.returned = evalScopeInfo.returned;
                    return null;
                }
                scopeInfo.lastIfCondition = conditionVal;
                if(conditionVal) {
                    if(body[0].type === TokenType.ParenOpen) { body = body.slice(1, body.length - 1); }
                    const bodyScopeInfo = new ScopeInfo(scopeInfo);
                    bodyScopeInfo.tokens = body;
                    this._executeBlock(bodyScopeInfo, [Signal.Break, Signal.Continue, Signal.Return]);
                    if(bodyScopeInfo.signal !== Signal.None) {
                        scopeInfo.signal = bodyScopeInfo.signal;
                        scopeInfo.returned = bodyScopeInfo.returned;
                    }
                }
                return null;
            });
            this._addCoreMacro("else", 1, (scopeInfo, body) => {
                if(scopeInfo.lastIfCondition === undefined) {
                    throwError("'else' called without a prior call to 'if' in the same scope", body);
                }
                if(!scopeInfo.lastIfCondition) {
                    if(body[0].type === TokenType.ParenOpen) { body = body.slice(1, body.length - 1); }
                    const bodyScopeInfo = new ScopeInfo(scopeInfo);
                    bodyScopeInfo.tokens = body;
                    this._executeBlock(bodyScopeInfo, [Signal.Break, Signal.Continue, Signal.Return]);
                    if(bodyScopeInfo.signal !== Signal.None) {
                        scopeInfo.signal = bodyScopeInfo.signal;
                        scopeInfo.returned = bodyScopeInfo.returned;
                    }
                }
            });

            this._addCoreMacro("loop", 1, (scopeInfo, body) => {
                if(body[0].type === TokenType.ParenOpen) { body = body.slice(1, body.length - 1); }
                const loopScopeInfo = new ScopeInfo(scopeInfo);
                loopScopeInfo.tokens = body;
                while(true) {
                    loopScopeInfo.index = 0;
                    loopScopeInfo.signal = Signal.None;
                    this._executeBlock(loopScopeInfo, [Signal.Break, Signal.Continue, Signal.Return]);
                    if(loopScopeInfo.signal === Signal.Return || loopScopeInfo.signal === Signal.Break) {
                        scopeInfo.signal = loopScopeInfo.signal;
                        scopeInfo.returned = loopScopeInfo.returned;
                        return null;
                    }
                }
                return null;
            });
            this._addCoreMacro("while", 2, (scopeInfo, condition, body) => {
                if(body[0].type === TokenType.ParenOpen) { body = body.slice(1, body.length - 1); }
                const loopScopeInfo = new ScopeInfo(scopeInfo);
                loopScopeInfo.tokens = body;
                while(true) {
                    {
                        const evalScopeInfo = new ScopeInfo(scopeInfo);
                        evalScopeInfo.tokens = condition;
                        const conditionVal = this._executeTokens(evalScopeInfo);
                        if(evalScopeInfo.signal !== Signal.None) {
                            scopeInfo.signal = evalScopeInfo.signal;
                            scopeInfo.returned = evalScopeInfo.returned;
                            return null;
                        }
                        if(!conditionVal) { break; }
                    }
                    loopScopeInfo.index = 0;
                    loopScopeInfo.signal = Signal.None;
                    this._executeBlock(loopScopeInfo, [Signal.Break, Signal.Continue, Signal.Return]);
                    if(loopScopeInfo.signal === Signal.Return || loopScopeInfo.signal === Signal.Break) {
                        scopeInfo.signal = loopScopeInfo.signal;
                        scopeInfo.returned = loopScopeInfo.returned;
                        return null;
                    }
                }
                return null;
            });

            this._addCoreMacro("return", 1, (scopeInfo, value) => {
                const evalScopeInfo = new ScopeInfo(scopeInfo);
                evalScopeInfo.tokens = value;
                scopeInfo.returned = this._executeTokens(evalScopeInfo);
                scopeInfo.signal = Signal.Return;
                return scopeInfo.returned;
            });
            this._addCoreMacro("continue", 0, (scopeInfo) => {
                scopeInfo.signal = Signal.Continue;
                return null;
            });
            this._addCoreMacro("break", 0, (scopeInfo) => {
                scopeInfo.signal = Signal.Break;
                return null;
            });

            this._addJsFunction("eval", 1, (tokens) => {
                const evalScopeInfo = new ScopeInfo(tokens.scopeInfo);
                if(tokens[0].type === TokenType.ParenOpen) { tokens = tokens.slice(1, tokens.length - 1); }
                evalScopeInfo.tokens = tokens;
                return this._executeBlock(evalScopeInfo, []);
            });

            this._addCoreMacro("var", 2, (scopeInfo, name, value) => {
                if(name.length !== 1 || name[0].type !== TokenType.Other) {
                    throwError("the provided variable name is not an identifier", name);
                }
                const evalScopeInfo = new ScopeInfo(scopeInfo);
                evalScopeInfo.tokens = value;
                scopeInfo.variables[name[0].content] = this._executeTokens(evalScopeInfo);
                if(evalScopeInfo.signal !== Signal.None) {
                    scopeInfo.signal = evalScopeInfo.signal;
                    scopeInfo.returned = evalScopeInfo.returned;
                }
                return null;
            });
            this._addCoreMacro("set", 2, (scopeInfo, name, value) => {
                if(name.length !== 1 || name[0].type !== TokenType.Other) {
                    throwError("the provided variable name is not an identifier", name);
                }
                let currentScopeInfo = scopeInfo;
                while(currentScopeInfo.variables[name[0].content] === undefined) {
                    if(currentScopeInfo.parentScope === null) { return null; }
                    currentScopeInfo = currentScopeInfo.parentScope;
                }
                const evalScopeInfo = new ScopeInfo(scopeInfo);
                evalScopeInfo.tokens = value;
                currentScopeInfo.variables[name[0].content] = this._executeTokens(evalScopeInfo);
                if(evalScopeInfo.signal !== Signal.None) {
                    scopeInfo.signal = evalScopeInfo.signal;
                    scopeInfo.returned = evalScopeInfo.returned;
                }
                return null;
            });

            this._addJsFunction("js", 1, (jsText) => eval(jsText));

            this._addCoreMacro("record", 2, (scopeInfo, name, memberNames) => {
                if(name.length !== 1 || name[0].type !== TokenType.Other) {
                    throwError("the provided record name is not an identifier", name);
                }
                let memberNamesParsed = this._parseTokenArray(memberNames);
                if(memberNamesParsed === null) {
                    throwError("the member name list is not an array of single identifiers", argNames);
                }
                memberNamesParsed = memberNamesParsed.map((name) => {
                    if(name.length !== 1 || name[0].type !== TokenType.Other) {
                        throwError("one of the member names is not a single identifier", name);
                    }
                    return name[0].content;
                });
                const recordConstructor = (...memberValues) => {
                    const instance = {};
                    if(memberValues.length !== memberNamesParsed.length) {
                        throwError(`record '${name[0].content}' has ${memberNamesParsed.length} members, but values for ${memberValues.length} were provided`, argNames);
                    }
                    for(let memberIndex = 0; memberIndex < memberValues.length; memberIndex += 1) {
                        instance[memberNamesParsed[memberIndex]] = memberValues[memberIndex];
                    }
                    return instance;
                };
                this._addJsFunction(name[0].content, memberNamesParsed.length, recordConstructor);
                return null;
            });


            this.eval(`
                vfunc display js "(msg) => console.log(msg)"
                vfunc throw js "(thing) => { throw thing; }"

                vfunc call js "(f, args) => f(...args)"

                vfunc object js "() => { return {}; }"
                vfunc getm js "(thing, member) => thing[member]"
                vfunc setm js "(thing, member, value) => { thing[member] = value; return thing; }"

                var stop_with_error lambda(reason tokens) (
                    throw + "(from Vilm) " generate_error reason tokens
                )

                macro error(reason) (
                    call stop_with_error (eval reason reason)
                )
                macro assert(condition) (
                    if ! eval condition (
                        call stop_with_error ("assertion failed" condition)
                    )
                )
                macro todo(thing) (
                    call stop_with_error (+ "not yet implemented: " eval thing thing)
                )

                vfunc is_number js "(thing) => typeof thing === 'number'"
                vfunc is_string js "(thing) => typeof thing === 'string'"
                vfunc is_object js "(thing) => typeof thing === 'object'"
                vfunc is_function js "(thing) => typeof thing === 'function'"
            `, "misc.vl");
            this._addJsFunction("generate_error", 2, (message, tokens) => generateErrorMessage(message, tokens));
            
            this.eval(`
                vfunc + js "(a, b) => a + b"
                vfunc - js "(a, b) => a - b"
                vfunc * js "(a, b) => a * b"
                vfunc / js "(a, b) => a / b"
                vfunc % js "(a, b) => a % b"
                vfunc ~ js "(x) => -x"
            `, "arithmetic.vl")

            this.eval(`
                vfunc < js "(a, b) => a < b"
                vfunc > js "(a, b) => a > b"
                vfunc <= js "(a, b) => a <= b"
                vfunc >= js "(a, b) => a >= b"
                vfunc == js "(a, b) => a === b"
                vfunc != js "(a, b) => a !== b"

                vfunc ! js "(x) => !x"

                macro &&(a b) (
                    if ! eval a return false
                    eval b
                )
            
                macro ||(a b) (
                    if eval a return true
                    eval b
                )
            `, "logic.vl");

            this.eval(`
                pkg math

                macro E() js "Math.E"
                macro LN10() js "Math.LN10"
                macro LN2() js "Math.LN2"
                macro LOG10E() js "Math.LOG10E"
                macro LOG2E() js "Math.LOG2E"
                macro PI() js "Math.PI"
                macro TAU() {js "Math.PI" * 2}
                macro SQRT1_2() js "Math.SQRT1_2"
                macro SQRT2() js "Math.SQRT2"

                vfunc abs js "Math.abs"
                vfunc acos js "Math.acos"
                vfunc acosh js "Math.acosh"
                vfunc asin js "Math.asin"
                vfunc asinh js "Math.asinh"
                vfunc atan js "Math.atan"
                vfunc atan2 js "Math.atan2"
                vfunc atanh js "Math.atanh"
                vfunc cbrt js "Math.cbrt"
                vfunc ceil js "Math.ceil"
                vfunc clz32 js "Math.clz32"
                vfunc cos js "Math.cos"
                vfunc cosh js "Math.cosh"
                vfunc exp js "Math.exp"
                vfunc expm1 js "Math.expm1"
                vfunc floor js "Math.floor"
                vfunc fround js "Math.fround"
                vfunc hypot js "Math.hypot"
                vfunc imul js "Math.imul"
                vfunc log js "Math.log"
                vfunc log10 js "Math.log10"
                vfunc log1p js "Math.log1p"
                vfunc log2 js "Math.log2"
                vfunc max js "Math.max"
                vfunc min js "Math.min"
                vfunc pow js "Math.pow"
                vfunc random js "Math.random"
                vfunc round js "Math.round"
                vfunc sign js "Math.sign"
                vfunc sin js "Math.sin"
                vfunc sinh js "Math.sinh"
                vfunc sqrt js "Math.sqrt"
                vfunc tan js "Math.tan"
                vfunc tanh js "Math.tanh"
                vfunc trunc js "Math.trunc"

                vfunc as_radians js "(degrees) => degrees * (Math.PI * 2) / 360"
                vfunc as_degrees js "(radians) => radians * 360 / (Math.PI * 2)"
            `, "math.vl");

            this.eval(`
                pkg data

                func list:new () ( return () )
                vfunc list:new_sized js "(size) => new Array(size)"
                func list:size(list) getm list "length" 
                vfunc list:at js "(l, i) => l.at(i)"
                vfunc list:concat js "(l, o) => l.concat(o)"
                vfunc list:every js "(l, c) => l.every(c)"
                vfunc list:fill js "(l, v) => l.fill(v)"
                vfunc list:filter js "(l, c) => l.filter(c)"
                vfunc list:find js "(l, c) => l.find(c)"
                vfunc list:find_index js "(l, c) => l.findIndex(c)"
                vfunc list:find_last js "(l, c) => l.findLast(c)"
                vfunc list:find_last_index js "(l, c) => l.findLastIndex(c)"
                vfunc list:flat js "(l) => l.flat()"
                vfunc list:for_each js "(l, c) => l.forEach(c)"
                vfunc list:includes js "(l, e) => l.includes(e)"
                vfunc list:index_of js "(l, e) => l.indexOf(e)"
                vfunc list:join js "(l, s) => l.join(s)"
                vfunc list:keys js "(l) => Array.from(l.keys())"
                vfunc list:last_index_of js "(l, e) => l.lastIndexOf(e)"
                vfunc list:map js "(l, c) => l.map(c)"
                vfunc list:pop js "(l) => l.pop()"
                vfunc list:push js "(l, e) => l.push(e)"
                vfunc list:reverse js "(l) => l.reverse()"
                vfunc list:shift js "(l) => l.shift()"                
                vfunc list:slice js "(l, start, end) => l.slice(start, end)"
                vfunc list:some js "(l, c) => l.some(c)"
                vfunc list:sort js "(l, c) => l.sort(c)"
                vfunc list:splice js "(l, start, end) => l.splice(start, end)"
                vfunc list:to_reversed js "(l) => l.toReversed()"
                vfunc list:to_sorted js "(l, c) => l.toSorted(c)"
                vfunc list:unshift js "(l, e) => l.unshift(e)"
                vfunc list:with js "(l, i, e) => l.with(i, e)"

                vfunc map:new js "() => new Map()"
                func map:size(map) getm map "size"
                vfunc map:clear js "(m) => m.clear()"
                vfunc map:delete js "(m, k) => m.delete(k)"
                vfunc map:for_each js "(m, c) => m.forEach(c)"
                vfunc map:get js "(m, k) => m.get(k)"
                vfunc map:has js "(m, k) => m.has(k)"
                vfunc map:keys js "(m) => Array.from(m.keys())"
                vfunc map:set js "(m, k, v) => m.set(k, v)"
                vfunc map:values js "(m) => Array.from(m.values())"

                func str:size(str) getm str "length"
                vfunc str:at js "(s, i) => s.at(i)"
                vfunc str:char_at js "(s, i) => s.charAt(i)"
                vfunc str:char_code_at js "(s, i) => s.charCodeAt(i)"
                vfunc str:code_point_at js "(s, i) => s.codePointAt(i)"
                vfunc str:concat js "(s, o) => s.concat(o)"
                vfunc str:ends_with js "(s, w) => s.endsWith(w)"
                vfunc str:includes js "(s, w) => s.includes(w)"
                vfunc str:index_of js "(s, w) => s.indexOf(w)"
                vfunc str:is_well_formed js "(s) => s.isWellFormed()"
                vfunc str:last_index_of js "(s, w) => s.lastIndexOf(w)"
                vfunc str:match js "(s, r) => s.match(r)"
                vfunc str:match_all js "(s, r) => s.matchAll(r)"
                vfunc str:normalize js "(s) => s.normalize()"
                vfunc str:pad_end js "(s, l, p) => s.padEnd(l, p)"
                vfunc str:pad_start js "(s, l, p) => s.padStart(l, p)"
                vfunc str:repeat js "(s, c) => s.repeat(c)"
                vfunc str:replace js "(s, p, r) => s.replace(p, r)"
                vfunc str:replace_all js "(s, p, r) => s.replaceAll(p, r)"
                vfunc str:search js "(s, r) => s.search(r)"
                vfunc str:slice js "(s, start, end) => s.slice(start, end)"
                vfunc str:split js "(s, sep) => s.split(sep)"
                vfunc str:starts_with js "(s, w) => s.startsWith(w)"
                vfunc str:substring js "(s, start, end) => s.substring(start, end)"
                vfunc str:to_lower_case js "(s) => s.toLowerCase()"
                vfunc str:to_upper_case js "(s) => s.toUpperCase()"
                vfunc str:to_well_formed js "(s) => s.toWellFormed()"
                vfunc str:trim js "(s) => s.trim()"
                vfunc str:trim_end js "(s) => s.trimEnd()"
                vfunc str:trim_start js "(s) => s.trimStart()"
            `, "data.vl");

            this.eval(`
                pkg meta

                vfunc keys_of js "(o) => Object.keys(o)"
                vfunc values_of js "(o) => Object.values(o)"
                vfunc type_of js "(o) => typeof o"
            `, "meta.vl");
            this._addCoreMacro("scope:current", 0, (scopeInfo) => scopeInfo.variables);
            this._addJsFunction("pkg:current", 0, () => this.currentPackage);
            this._addJsFunction("pkg:from_name", 1, (name) => this.packages.get(name));
            this._addJsFunction("pkg:has_func", 2, (pkg, name) => pkg.jsFunctions.has(name) || pkg.functions.has(name));
            this._addJsFunction("pkg:has_vfunc", 2, (pkg, name) => pkg.jsFunctions.has(name));
            this._addJsFunction("pkg:has_macro", 2, (pkg, name) => pkg.coreMacros.has(name) || pkg.macros.has(name));

            this.eval(`
                pkg time

                vfunc unix_millis js "Date.now"
                vfunc after_millis js "(action, timeout) => window.setTimeout(action, timeout)"
                func unix_seconds() {unix_millis / 1000}
                func after_seconds(action timeout) after_millis action {timeout * 1000}
            `, "time.vl");

            this.eval(`
                pkg random

                use math (random floor)
                use data list:size

                func choice_from(from) {from getm floor {random * getm from "length"}}
                func float_in(min max) {{random * {max - min}} + min}
                func integer_in(min max) floor float_in min max
            `, "random.vl");
        }

        _parseTokenArray(tokens) {
            let index = 0;
            if(tokens[index].type !== TokenType.ParenOpen) { return null; }
            index += 1;
            const tokenArrays = [];
            while(index < tokens.length && tokens[index].type !== TokenType.ParenClose) {
                const startIndex = index;
                index = this._calculateExprLength(tokens, index);
                tokenArrays.push(tokens.slice(startIndex, index));
            }
            if(index >= tokens.length && tokens[index].type !== TokenType.ParenClose) { return null; }
            return tokenArrays;
        }

        _calculateExprLength(tokens, index) {
            if(index >= tokens.length) {
                throwError("unexpected end of expression", tokens[tokens.length - 1]);
            }
            switch(tokens[index].type) {
                case TokenType.ParenOpen: {
                    const start = index;
                    index += 1;
                    let scope = 0;
                    while(index < tokens.length) {
                        switch(tokens[index].type) {
                            case TokenType.ParenOpen: scope += 1; break;
                            case TokenType.ParenClose: {
                                if(scope === 0) { return index + 1; }
                                scope -= 1;    
                            } break;
                        }
                        index += 1;
                    }
                    if(scope !== 0) {
                        throwError("unclosed array literal", tokens.slice(start));
                    }
                } break;
                case TokenType.BraceOpen: {
                    index += 1;
                    index = this._calculateExprLength(tokens, index);
                    const name = tokens[index].content;
                    let argCount;
                    if(this.currentPackage.coreMacros.has(name)) { argCount = this.currentPackage.coreMacros.get(name).argCount; }
                    else if(this.currentPackage.jsFunctions.has(name)) { argCount = this.currentPackage.jsFunctions.get(name).argCount; }
                    else if(this.currentPackage.macros.has(name)) { argCount = this.currentPackage.macros.get(name).argNames.length; }
                    else if(this.currentPackage.functions.has(name)) { argCount = this.currentPackage.functions.get(name).argNames.length; }
                    else { throwError(`'${name}' is not a known macro or function`, tokens[index]); }
                    index += 1;
                    for(let argIndex = 1; argIndex < argCount; argIndex += 1) {
                        index = this._calculateExprLength(tokens, index);
                    }
                    if(tokens[index].type !== TokenType.BraceClose) {
                        throwError(`too many arguments for infix call to function '${name}'`, tokens[index]);
                    }
                    return index + 1;
                }
                case TokenType.Other: {
                    const name = tokens[index].content;
                    let argCount;
                    if(this.currentPackage.coreMacros.has(name)) { argCount = this.currentPackage.coreMacros.get(name).argCount; }
                    else if(this.currentPackage.jsFunctions.has(name)) { argCount = this.currentPackage.jsFunctions.get(name).argCount; }
                    else if(this.currentPackage.macros.has(name)) { argCount = this.currentPackage.macros.get(name).argNames.length; }
                    else if(this.currentPackage.functions.has(name)) { argCount = this.currentPackage.functions.get(name).argNames.length; }
                    else { return index + 1; }
                    index += 1;
                    for(let argIndex = 0; argIndex < argCount; argIndex += 1) {
                        index = this._calculateExprLength(tokens, index);
                    }
                    return index;
                } break;
                case TokenType.Number:
                case TokenType.String:
                    return index + 1;
            }
            throwError("unexpected token", tokens[index]);
        }

        _executeTokens(scopeInfo) {
            if(scopeInfo.index >= scopeInfo.tokens.length) {
                throwError("unexpected end of expression", scopeInfo.tokens[scopeInfo.tokens.length - 1]);
            }
            switch(scopeInfo.tokens[scopeInfo.index].type) {
                case TokenType.Number: {
                    const num = Number(scopeInfo.tokens[scopeInfo.index].content);
                    scopeInfo.index += 1;
                    return num;
                } break;
                case TokenType.String: {
                    const str = scopeInfo.tokens[scopeInfo.index].content;
                    scopeInfo.index += 1;
                    return str.substring(1, str.length - 1);
                } break;
                case TokenType.ParenOpen: {
                    const arr = [];
                    const start = scopeInfo.index;
                    scopeInfo.index += 1;
                    if(scopeInfo.index >= scopeInfo.tokens.length) {
                        throwError("unclosed array literal", scopeInfo.tokens.slice(start));
                    }
                    while(scopeInfo.tokens[scopeInfo.index].type !== TokenType.ParenClose) {
                        arr.push(this._executeTokens(scopeInfo));
                        if(scopeInfo.index >= scopeInfo.tokens.length) {
                            throwError("unclosed array literal", scopeInfo.tokens.slice(start));
                        }
                    }
                    scopeInfo.index += 1;
                    return arr;
                } break;
                case TokenType.BraceOpen: {
                    scopeInfo.index += 1;
                    const firstParamStartIndex = scopeInfo.index;
                    scopeInfo.index = this._calculateExprLength(scopeInfo.tokens, scopeInfo.index);
                    const firstParamEndIndex = scopeInfo.index;
                    const name = scopeInfo.tokens[scopeInfo.index].content;
                    scopeInfo.index += 1;
                    let resultVal;
                    if(this.currentPackage.coreMacros.has(name)) {
                        const coreMacro = this.currentPackage.coreMacros.get(name);
                        const args = [];
                        {
                            const arg = scopeInfo.tokens.slice(firstParamStartIndex, firstParamEndIndex);
                            arg.scopeInfo = scopeInfo;
                            args.push(arg);
                        }
                        for(let argIndex = 1; argIndex < coreMacro.argCount; argIndex += 1) {
                            const startIndex = scopeInfo.index;
                            scopeInfo.index = this._calculateExprLength(scopeInfo.tokens, scopeInfo.index);
                            const arg = scopeInfo.tokens.slice(startIndex, scopeInfo.index);
                            arg.scopeInfo = scopeInfo;
                            args.push(arg);
                        }
                        resultVal = coreMacro.handler(scopeInfo, ...args);
                    } else if(this.currentPackage.jsFunctions.has(name)) {
                        const jsFunction = this.currentPackage.jsFunctions.get(name);
                        const args = [];
                        {
                            const preEvalIndex = scopeInfo.index;
                            scopeInfo.index = firstParamStartIndex;
                            args.push(this._executeTokens(scopeInfo));
                            scopeInfo.index = preEvalIndex;
                        }
                        for(let argIndex = 1; argIndex < jsFunction.argCount; argIndex += 1) {
                            args.push(this._executeTokens(scopeInfo));
                        }
                        resultVal = jsFunction.jsFunction(...args);
                    } else if(this.currentPackage.macros.has(name)) {
                        const macro = this.currentPackage.macros.get(name);
                        const macroScopeInfo = new ScopeInfo(macro.parentScope);
                        macroScopeInfo.tokens = macro.body;
                        {
                            const arg = scopeInfo.tokens.slice(firstParamStartIndex, firstParamEndIndex);
                            arg.scopeInfo = scopeInfo;
                            macroScopeInfo.variables[macro.argNames[0]] = arg;
                        }
                        for(let argIndex = 1; argIndex < macro.argNames.length; argIndex += 1) {
                            const startIndex = scopeInfo.index;
                            scopeInfo.index = this._calculateExprLength(scopeInfo.tokens, scopeInfo.index);
                            const arg = scopeInfo.tokens.slice(startIndex, scopeInfo.index);
                            arg.scopeInfo = scopeInfo;
                            macroScopeInfo.variables[macro.argNames[argIndex]] = arg;
                        }
                        const oldPackage = this.currentPackage;
                        this.currentPackage = macro.declaredIn;
                        resultVal = this._executeBlock(macroScopeInfo, [Signal.Return]);
                        this.currentPackage = oldPackage;
                    } else if(this.currentPackage.functions.has(name)) {
                        const fun = this.currentPackage.functions.get(name);
                        const funScopeInfo = new ScopeInfo(fun.parentScope);
                        funScopeInfo.tokens = fun.body;
                        {
                            const preEvalIndex = scopeInfo.index;
                            scopeInfo.index = firstParamStartIndex;
                            funScopeInfo.variables[fun.argNames[0]] = this._executeTokens(scopeInfo);
                            scopeInfo.index = preEvalIndex;
                        }
                        for(let argIndex = 1; argIndex < fun.argNames.length; argIndex += 1) {
                            funScopeInfo.variables[fun.argNames[argIndex]] = this._executeTokens(scopeInfo);
                        }
                        const oldPackage = this.currentPackage;
                        this.currentPackage = fun.declaredIn;
                        resultVal = this._executeBlock(funScopeInfo, [Signal.Return]);
                        this.currentPackage = oldPackage;
                    } else {
                        throwError(`'${name}' is not a known macro or function`, scopeInfo.tokens[scopeInfo.index - 1]);
                    }
                    if(scopeInfo.tokens[scopeInfo.index].type !== TokenType.BraceClose) {
                        throwError(`too many arguments for infix call to function '${name}'`, scopeInfo.tokens[scopeInfo.index]);
                    }
                    scopeInfo.index += 1;
                    return resultVal;
                }
                case TokenType.Other: {
                    const name = scopeInfo.tokens[scopeInfo.index].content;
                    scopeInfo.index += 1;
                    if(this.currentPackage.coreMacros.has(name)) {
                        const coreMacro = this.currentPackage.coreMacros.get(name);
                        const args = [];
                        for(let argIndex = 0; argIndex < coreMacro.argCount; argIndex += 1) {
                            const startIndex = scopeInfo.index;
                            scopeInfo.index = this._calculateExprLength(scopeInfo.tokens, scopeInfo.index);
                            const arg = scopeInfo.tokens.slice(startIndex, scopeInfo.index);
                            arg.scopeInfo = scopeInfo;
                            args.push(arg);
                        }
                        return coreMacro.handler(scopeInfo, ...args);
                    } else if(this.currentPackage.jsFunctions.has(name)) {
                        const jsFunction = this.currentPackage.jsFunctions.get(name);
                        const args = [];
                        for(let argIndex = 0; argIndex < jsFunction.argCount; argIndex += 1) {
                            args.push(this._executeTokens(scopeInfo));
                        }
                        return jsFunction.jsFunction(...args);
                    } else if(this.currentPackage.macros.has(name)) {
                        const macro = this.currentPackage.macros.get(name);
                        const macroScopeInfo = new ScopeInfo(macro.parentScope);
                        macroScopeInfo.tokens = macro.body;
                        for(let argIndex = 0; argIndex < macro.argNames.length; argIndex += 1) {
                            const startIndex = scopeInfo.index;
                            scopeInfo.index = this._calculateExprLength(scopeInfo.tokens, scopeInfo.index);
                            const arg = scopeInfo.tokens.slice(startIndex, scopeInfo.index);
                            arg.scopeInfo = scopeInfo;
                            macroScopeInfo.variables[macro.argNames[argIndex]] = arg;
                        }
                        const oldPackage = this.currentPackage;
                        this.currentPackage = macro.declaredIn;
                        const returnVal = this._executeBlock(macroScopeInfo, [Signal.Return]);
                        this.currentPackage = oldPackage;
                        return returnVal;
                    } else if(this.currentPackage.functions.has(name)) {
                        const fun = this.currentPackage.functions.get(name);
                        const funScopeInfo = new ScopeInfo(fun.parentScope);
                        funScopeInfo.tokens = fun.body;
                        for(let argIndex = 0; argIndex < fun.argNames.length; argIndex += 1) {
                            funScopeInfo.variables[fun.argNames[argIndex]] = this._executeTokens(scopeInfo);
                        }
                        const oldPackage = this.currentPackage;
                        this.currentPackage = fun.declaredIn;
                        const returnVal = this._executeBlock(funScopeInfo, [Signal.Return]);
                        this.currentPackage = oldPackage;
                        return returnVal;
                    } else {
                        let currentScopeInfo = scopeInfo;
                        while(currentScopeInfo.variables[name] === undefined && currentScopeInfo.parentScope !== null) {
                            currentScopeInfo = currentScopeInfo.parentScope;
                        }
                        return currentScopeInfo.variables[name];
                    }
                } break;
            }
            throwError("unexpected token", scopeInfo.tokens[scopeInfo.index]);
        }

        _executeBlock(scopeInfo, breakSignals) {
            let lastValue = null;
            while(scopeInfo.index < scopeInfo.tokens.length && !breakSignals.includes(scopeInfo.signal)) {
                lastValue = this._executeTokens(scopeInfo);
            }
            return scopeInfo.returned === null? lastValue : scopeInfo.returned;
        }

        eval(source, file) {
            if(typeof file === "undefined") { file = "<unknown>"; }
            const tokens = tokenize(source, { name: file, content: source });

            const baseScope = new ScopeInfo();
            baseScope.variables["true"] = true;
            baseScope.variables["false"] = false;
            baseScope.variables["null"] = null;
            baseScope.variables["undefined"] = undefined;
            baseScope.tokens = tokens;

            this.currentPackage = this._getPackage("");
            return this._executeBlock(baseScope, [Signal.Return]);
        }

        evalFiles(...files) {
            for(const file of files) {
                const queued = {
                    name: file,
                    content: null
                };
                this.fileQueue.push(queued);
                fetch(file)
                    .then((request) => request.text())
                    .then((content) => {
                        queued.content = content;
                        if(this.fileQueue[0] === queued) {
                            while(this.fileQueue.length > 0 && this.fileQueue[0].content !== null) {
                                const queuedFile = this.fileQueue.shift();
                                this.eval(queuedFile.content, queuedFile.name);
                            }
                        } else {
                            console.log("loaded too quickly!");
                        }
                    });
            }
            return this;
        }

    }

    return Vilm;
})();

if(typeof module !== "undefined") { module.exports = Vilm; }