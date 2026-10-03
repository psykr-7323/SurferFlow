const TYPE_ALIASES = new Map([
    ["f32", "float"], ["i32", "int"], ["u32", "uint"],
    ["vec2f", "vec2"], ["vec3f", "vec3"], ["vec4f", "vec4"],
    ["vec2i", "ivec2"], ["vec3i", "ivec3"], ["vec4i", "ivec4"],
    ["vec2u", "uvec2"], ["vec3u", "uvec3"], ["vec4u", "uvec4"],
    ["vec2b", "bvec2"], ["vec3b", "bvec3"], ["vec4b", "bvec4"],
    ["mat2x2f", "mat2"], ["mat3x3f", "mat3"], ["mat4x4f", "mat4"],
]);

const VECTOR_RE = /^(?:[biu]?vec)([234])$/;

function maskComments(source) {
    const chars = source.split("");
    let lineComment = false;
    let blockComment = false;
    for (let i = 0; i < chars.length; i++) {
        if (lineComment) {
            if (chars[i] === "\n") lineComment = false;
            else chars[i] = " ";
            continue;
        }
        if (blockComment) {
            if (chars[i] === "*" && chars[i + 1] === "/") {
                chars[i] = chars[i + 1] = " ";
                i++;
                blockComment = false;
            } else if (chars[i] !== "\n") chars[i] = " ";
            continue;
        }
        if (chars[i] === "/" && chars[i + 1] === "/") {
            chars[i] = chars[i + 1] = " ";
            i++;
            lineComment = true;
        } else if (chars[i] === "/" && chars[i + 1] === "*") {
            chars[i] = chars[i + 1] = " ";
            i++;
            blockComment = true;
        }
    }
    return chars.join("");
}

function splitTopLevel(text, delimiter = ",") {
    const parts = [];
    let start = 0;
    let round = 0, square = 0, curly = 0, angle = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "(") round++;
        else if (c === ")") round--;
        else if (c === "[") square++;
        else if (c === "]") square--;
        else if (c === "{") curly++;
        else if (c === "}") curly--;
        else if (c === "<") angle++;
        else if (c === ">") angle--;
        else if (c === delimiter && round === 0 && square === 0 && curly === 0 && angle === 0) {
            parts.push(text.slice(start, i).trim());
            start = i + 1;
        }
    }
    const tail = text.slice(start).trim();
    if (tail) parts.push(tail);
    return parts;
}

function matching(source, start, open = "{", close = "}") {
    let depth = 0;
    for (let i = start; i < source.length; i++) {
        if (source[i] === open) depth++;
        else if (source[i] === close && --depth === 0) return i;
    }
    return -1;
}

function typeSpec(typeText) {
    const raw = String(typeText || "").trim().replace(/,$/, "");
    const array = raw.match(/^array\s*<([\s\S]+)>$/);
    if (array) {
        const items = splitTopLevel(array[1]);
        const element = typeSpec(items[0]);
        return { base: element.base, size: items[1] || element.size || null, array: true };
    }

    if (TYPE_ALIASES.has(raw)) return { base: TYPE_ALIASES.get(raw), array: false };
    const genericVec = raw.match(/^vec([234])\s*<\s*(f32|i32|u32|bool)\s*>$/);
    if (genericVec) {
        const prefix = { f32: "", i32: "i", u32: "u", bool: "b" }[genericVec[2]];
        return { base: `${prefix}vec${genericVec[1]}`, array: false };
    }
    const matrix = raw.match(/^mat([234])x([234])f$/);
    if (matrix) return { base: `mat${matrix[1]}x${matrix[2]}`, array: false };
    const genericMatrix = raw.match(/^mat([234])x([234])\s*<\s*f32\s*>$/);
    if (genericMatrix) return { base: `mat${genericMatrix[1]}x${genericMatrix[2]}`, array: false };
    if (raw.startsWith("texture_2d")) return { base: "sampler2D", array: false };
    if (raw.startsWith("texture_cube")) return { base: "samplerCube", array: false };
    if (raw === "sampler" || raw === "sampler_comparison") return { base: "sampler", array: false };
    return { base: raw, array: false };
}

function typeName(typeText) {
    const spec = typeSpec(typeText);
    return spec.array ? `${spec.base}[${spec.size || ""}]` : spec.base;
}

function declaration(typeText, name, qualifier = "") {
    const spec = typeSpec(typeText);
    const array = spec.array ? `[${spec.size || ""}]` : "";
    return `${qualifier}${spec.base} ${name}${array}`;
}

function scanBlocks(source, keyword) {
    const masked = maskComments(source);
    const regex = new RegExp(`\\b${keyword}\\s+(\\w+)\\s*\\{`, "g");
    const out = [];
    let match;
    while ((match = regex.exec(masked))) {
        const open = masked.indexOf("{", match.index);
        const close = matching(masked, open);
        if (close < 0) continue;
        out.push({ name: match[1], start: match.index, open, close, body: source.slice(open + 1, close) });
        regex.lastIndex = close + 1;
    }
    return out;
}

function scanFunctions(source) {
    const masked = maskComments(source);
    const regex = /\bfn\s+(\w+)\s*\(/g;
    const out = [];
    let match;
    while ((match = regex.exec(masked))) {
        const name = match[1];
        const openParen = masked.indexOf("(", match.index);
        const closeParen = matching(masked, openParen, "(", ")");
        if (closeParen < 0) continue;
        const openBrace = masked.indexOf("{", closeParen);
        if (openBrace < 0) continue;
        const closeBrace = matching(masked, openBrace);
        if (closeBrace < 0) continue;
        const header = source.slice(match.index, openBrace);
        const params = source.slice(openParen + 1, closeParen);
        const returnMatch = header.match(/->\s*([\s\S]+?)\s*$/);
        const stageContext = masked.slice(Math.max(0, match.index - 32), match.index);
        const stage = /@vertex\s*$/.test(stageContext) ? "vertex"
            : /@fragment\s*$/.test(stageContext) ? "fragment" : "helper";
        out.push({
            name, start: match.index, openParen, closeParen, openBrace, closeBrace,
            params, returnType: returnMatch ? returnMatch[1].trim() : "void",
            body: source.slice(openBrace + 1, closeBrace), stage,
        });
        regex.lastIndex = closeBrace + 1;
    }
    return out;
}

function parseFields(body) {
    const fields = new Map();
    for (const part of splitTopLevel(maskComments(body).replace(/;\s*$/, ""))) {
        const match = part.replace(/@[\w() ,]+/g, "").match(/^\s*(\w+)\s*:\s*([\s\S]+?)\s*$/);
        if (match) fields.set(match[1], match[2].trim());
    }
    return fields;
}

function parseParams(params) {
    const values = [];
    for (const part of splitTopLevel(maskComments(params))) {
        const cleaned = part.replace(/@[\w() ,]+/g, "").trim();
        const colon = cleaned.indexOf(":");
        if (colon < 0) continue;
        values.push({ name: cleaned.slice(0, colon).trim(), type: cleaned.slice(colon + 1).trim() });
    }
    return values;
}

function makeTypeContext(sources) {
    const all = sources.join("\n");
    const structs = new Map();
    for (const block of scanBlocks(all, "struct")) structs.set(block.name, parseFields(block.body));

    const uniforms = new Map();
    const attributes = new Map();
    const varyings = new Map();
    const globals = new Map();
    const masked = maskComments(all);
    const functions = scanFunctions(all);
    const functionReturns = new Map();
    const functionSamplerIndices = new Map();
    for (const fn of functions) {
        functionReturns.set(fn.name, typeName(fn.returnType));
        const indices = parseParams(fn.params)
            .map((param, index) => typeSpec(param.type).base === "sampler" ? index : -1)
            .filter((index) => index >= 0);
        if (indices.length) functionSamplerIndices.set(fn.name, indices);
    }

    // ShaderMaterial's WGSL dialect uses top-level, column-zero declarations.
    // Restricting this scan to column zero keeps local `var` values out of it.
    const declarationRe = /^(uniform|attribute|varying|var)\s+(\w+)\s*:\s*([^;\n]+);/gm;
    let match;
    while ((match = declarationRe.exec(masked))) {
        const kind = match[1], name = match[2], type = match[3].trim();
        if (kind === "uniform") uniforms.set(name, typeName(type));
        else if (kind === "attribute") attributes.set(name, typeName(type));
        else if (kind === "varying") varyings.set(name, typeName(type));
        else globals.set(name, typeName(type));
    }

    const constants = /^(?:const|override)\s+(\w+)\s*:\s*([^=;\n]+)\s*=/gm;
    while ((match = constants.exec(masked))) globals.set(match[1], typeName(match[2]));

    return { structs, uniforms, attributes, varyings, globals, functions, functionReturns, functionSamplerIndices };
}

function stripOuterParens(text) {
    let out = text.trim();
    while (out.startsWith("(") && matching(out, 0, "(", ")") === out.length - 1) {
        out = out.slice(1, -1).trim();
    }
    return out;
}

function findTopLevelOperator(text, candidates) {
    let round = 0, square = 0, curly = 0;
    for (let i = text.length - 1; i >= 0; i--) {
        const c = text[i];
        if (c === ")") round++;
        else if (c === "(") round--;
        else if (c === "]") square++;
        else if (c === "[") square--;
        else if (c === "}") curly++;
        else if (c === "{") curly--;
        if (round || square || curly) continue;
        for (const op of candidates) {
            const start = i - op.length + 1;
            if (start < 0 || text.slice(start, i + 1) !== op) continue;
            if ((op === "+" || op === "-") && (start === 0 || /[+\-*/(<>=,!&|]/.test(text[start - 1]))) continue;
            if (op === "*" || op === "/") {
                if (text[start - 1] === "/" || text[i + 1] === "/") continue;
            }
            return { index: start, op };
        }
    }
    return null;
}

function splitCall(text) {
    const match = text.match(/^([A-Za-z_]\w*)\s*\(/);
    if (!match) return null;
    const open = text.indexOf("(", match.index);
    if (matching(text, open, "(", ")") !== text.length - 1) return null;
    return { name: match[1], args: splitTopLevel(text.slice(open + 1, -1)) };
}

function scalarType(type) {
    if (type === "float" || type === "vec2" || type === "vec3" || type === "vec4") return "float";
    if (type === "int" || type === "ivec2" || type === "ivec3" || type === "ivec4") return "int";
    if (type === "uint" || type === "uvec2" || type === "uvec3" || type === "uvec4") return "uint";
    if (type === "bool" || type?.startsWith("bvec")) return "bool";
    return type;
}

function vectorOf(type, prefix = "b") {
    const match = type?.match(VECTOR_RE);
    if (!match) return "bool";
    return `${prefix}vec${match[1]}`;
}

function inferExpressionType(expression, symbols, context) {
    let text = stripOuterParens(expression.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " "));
    if (!text) return null;

    const literal = text.match(/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?([uif])?$/);
    if (literal) return literal[1] === "u" ? "uint" : literal[1] === "i" ? "int"
        : /[.eE]/.test(text) || literal[1] === "f" ? "float" : "int";
    if (text === "true" || text === "false") return "bool";

    const expressionOperator = findTopLevelOperator(text, ["||", "&&", "==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "/", "%"]);
    const swizzle = text.match(/^([\s\S]+)\.([xyzwrgba]{1,4})$/);
    if (swizzle && !expressionOperator) {
        const base = inferExpressionType(swizzle[1], symbols, context);
        if (base?.match(VECTOR_RE)) return swizzle[2].length === 1 ? scalarType(base) : `${base.slice(0, -1)}${swizzle[2].length}`;
        if (base?.startsWith("mat")) return swizzle[2].length === 1 ? "float" : `vec${swizzle[2].length}`;
    }

    const indexMatch = text.match(/^([\s\S]+)\[([\s\S]+)\]$/);
    if (indexMatch && !findTopLevelOperator(indexMatch[1], ["||", "&&", "==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "/", "%"]) &&
        matching(text, text.indexOf("["), "[", "]") === text.length - 1) {
        const base = inferExpressionType(indexMatch[1], symbols, context);
        if (base?.includes("[")) return base.slice(0, base.indexOf("["));
        if (base?.match(VECTOR_RE)) return scalarType(base);
        return null;
    }

    const call = splitCall(text);
    if (call) {
        const constructor = typeSpec(call.name);
        if (constructor.base !== call.name || ["float", "int", "uint", "bool"].includes(call.name)) {
            return constructor.array ? `${constructor.base}[${constructor.size}]` : constructor.base;
        }
        const args = call.args;
        if (["textureSample", "textureSampleLevel", "textureSampleGrad", "textureLoad", "textureGather"].includes(call.name)) return "vec4";
        if (["dot", "length", "distance", "determinant"].includes(call.name)) return "float";
        if (["any", "all"].includes(call.name)) return "bool";
        if (call.name === "select" || ["normalize", "cross", "reflect", "refract", "abs", "sign", "floor", "ceil", "fract", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "exp", "exp2", "log", "log2", "sqrt", "inverseSqrt", "pow", "dpdx", "dpdy", "fwidth", "min", "max", "clamp", "mix", "smoothstep", "fma", "mod", "step", "transpose", "inverse"].includes(call.name)) {
            if (call.name === "inverse") return inferExpressionType(args[0], symbols, context) || "mat4";
            if (call.name === "atan2") return inferExpressionType(args[0], symbols, context) || "float";
            return inferExpressionType(args[0], symbols, context);
        }
        if (context.functionReturns.has(call.name)) return context.functionReturns.get(call.name);
        if (context.structs.has(call.name)) return call.name;
        return null;
    }

    for (const op of ["||", "&&", "==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "/", "%"] ) {
        const found = findTopLevelOperator(text, [op]);
        if (!found) continue;
        const left = inferExpressionType(text.slice(0, found.index), symbols, context);
        const right = inferExpressionType(text.slice(found.index + op.length), symbols, context);
        if (op === "||" || op === "&&") return "bool";
        if (["==", "!=", "<", ">", "<=", ">="].includes(op)) {
            return left?.match(VECTOR_RE) ? vectorOf(left) : "bool";
        }
        const leftMatrix = left?.match(/^mat([234])(?:x([234]))?$/);
        const rightMatrix = right?.match(/^mat([234])(?:x([234]))?$/);
        if (leftMatrix && right?.match(VECTOR_RE)) return `vec${leftMatrix[2] || leftMatrix[1]}`;
        if (rightMatrix && left?.match(VECTOR_RE)) return `vec${rightMatrix[1]}`;
        if (leftMatrix && rightMatrix) return `mat${rightMatrix[1]}x${leftMatrix[2] || leftMatrix[1]}`;
        if (leftMatrix) return left;
        if (rightMatrix) return right;
        if (left?.match(VECTOR_RE)) return left;
        if (right?.match(VECTOR_RE)) return right;
        return left || right;
    }

    if (/^[!]/.test(text)) return "bool";
    if (/^[-+]/.test(text)) return inferExpressionType(text.slice(1), symbols, context);

    const member = text.match(/^([\s\S]+)\.(\w+)$/);
    if (member) {
        const baseText = member[1].trim();
        const field = member[2];
        if (baseText === "uniforms") return context.uniforms.get(field) || null;
        if (baseText === "vertexInputs") return field === "vertexIndex" || field === "instanceIndex"
            ? "uint" : context.attributes.get(field) || null;
        if (baseText === "fragmentInputs" || baseText === "input") {
            if (field === "position") return "vec4";
            if (field === "frontFacing") return "bool";
            return context.varyings.get(field) || null;
        }
        const base = inferExpressionType(baseText, symbols, context);
        return context.structs.get(base)?.get(field) ? typeName(context.structs.get(base).get(field)) : null;
    }

    if (symbols.has(text)) return symbols.get(text);
    if (context.globals.has(text)) return context.globals.get(text);
    if (context.uniforms.has(text)) return context.uniforms.get(text);
    if (context.attributes.has(text)) return context.attributes.get(text);
    if (context.varyings.has(text)) return context.varyings.get(text);
    return null;
}

function replaceFunctionLocals(body, fn, context, filename) {
    const masked = maskComments(body);
    const regex = /\b(const|let|var)\s+(\w+)\s*(?::\s*([^=;\n]+?))?\s*(?:=\s*([\s\S]*?))?;/g;
    const replacements = [];
    const symbols = new Map(context.globals);
    for (const [name, type] of context.uniforms) symbols.set(name, type);
    for (const [name, type] of context.attributes) symbols.set(name, type);
    for (const [name, type] of context.varyings) symbols.set(name, type);
    for (const param of parseParams(fn.params)) symbols.set(param.name, typeName(param.type));

    if (fn.stage === "vertex") {
        symbols.set("input", "VertexInputs");
        symbols.set("vertexInputs", "VertexInputs");
        symbols.set("vertexOutputs", "FragmentInputs");
    } else if (fn.stage === "fragment") {
        symbols.set("input", "FragmentInputs");
        symbols.set("fragmentInputs", "FragmentInputs");
        symbols.set("fragmentOutputs", "FragmentOutputs");
    }

    let match;
    while ((match = regex.exec(masked))) {
        const [declarationKind, name, explicitType, init] = match.slice(1);
        const wgslType = explicitType?.trim() || inferExpressionType(init || "", symbols, context);
        if (!wgslType) {
            throw new Error(`${filename}: cannot infer GLSL type for ${name} = ${init?.trim() || "<uninitialized>"}`);
        }
        const spec = typeSpec(wgslType);
        symbols.set(name, spec.array ? `${spec.base}[${spec.size}]` : spec.base);
        const initText = init === undefined ? "" : ` = ${init.trim()}`;
        replacements.push({
            start: match.index,
            end: regex.lastIndex,
            value: `${declarationKind === "const" ? "const " : ""}${declaration(wgslType, name)}${initText};`,
        });
    }

    let output = body;
    for (let i = replacements.length - 1; i >= 0; i--) {
        const item = replacements[i];
        output = output.slice(0, item.start) + item.value + output.slice(item.end);
    }
    return output;
}

function convertStructDeclarations(source) {
    const blocks = scanBlocks(source, "struct");
    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];
        const fields = [];
        for (const field of parseFields(block.body)) fields.push(`    ${declaration(field[1], field[0])};`);
        const value = `struct ${block.name} {\n${fields.join("\n")}\n};`;
        source = source.slice(0, block.start) + value + source.slice(block.close + 1);
    }
    return source;
}

function convertEntryPointBody(body, stage) {
    if (stage === "vertex") {
        return body
            .replace(/\bvertexInputs\.(position|normal|uv|color|aux|boneIdx|boneWt|world[0-3])\b/g, "$1")
            .replace(/\bvertexInputs\.vertexIndex\b/g, "gl_VertexID")
            .replace(/\bvertexInputs\.instanceIndex\b/g, "gl_InstanceID")
            .replace(/\bvertexOutputs\.position\b/g, "gl_Position")
            .replace(/\bvertexOutputs\.(v\w+)\b/g, "$1");
    }
    if (stage === "fragment") {
        return body
            .replace(/\b(?:fragmentInputs|input)\.position\b/g, "gl_FragCoord")
            .replace(/\b(?:fragmentInputs|input)\.frontFacing\b/g, "gl_FrontFacing")
            .replace(/\b(?:fragmentInputs|input)\.(v\w+)\b/g, "$1")
            .replace(/\bfragmentOutputs\.color\b/g, "gl_FragColor")
            .replace(/\bfragmentOutputs\.fragDepth\b/g, "gl_FragDepth");
    }
    return body;
}

function convertFunctionDefinitions(source, context, filename) {
    const functions = scanFunctions(source);
    for (let i = functions.length - 1; i >= 0; i--) {
        const fn = functions[i];
        const params = parseParams(fn.params)
            .filter((param) => typeSpec(param.type).base !== "sampler")
            .map((param) => declaration(param.type, param.name)).join(", ");
        const returnType = fn.stage === "helper" ? typeName(fn.returnType) : "void";
        let body = replaceFunctionLocals(fn.body, fn, context, filename);
        body = convertEntryPointBody(body, fn.stage);
        body = rewriteCalls(body, context.functionSamplerIndices, (name, args, indices) =>
            `${name}(${args.filter((_arg, index) => !indices.includes(index)).join(", ")})`
        );
        const header = `${returnType} ${fn.name}(${fn.stage === "helper" ? params : ""}) {`;
        source = source.slice(0, fn.start) + header + body + source.slice(fn.closeBrace);
    }
    return source;
}

function replaceGlobalDeclarations(source, context, filename) {
    source = source.replace(/^(uniform|attribute|varying)\s+(\w+)\s*:\s*([^;\n]+);/gm,
        (_whole, kind, name, type) => declaration(type, name, `${kind} `) + ";");
    source = source.replace(/^var\s+(\w+)\s*:\s*texture_2d(?:_array)?\s*<[^;]+>\s*;/gm,
        (_whole, name) => `uniform sampler2D ${name};`);
    source = source.replace(/^var\s+\w+\s*:\s*sampler(?:_comparison)?\s*;/gm, "");
    source = source.replace(/^const\s+(\w+)\s*:\s*([^=;\n]+)\s*=/gm,
        (_whole, name, type) => `${declaration(type, name, "const ")} =`);
    source = source.replace(/^const\s+(\w+)\s*=\s*([\s\S]*?);/gm, (whole, name, expression) => {
        const type = inferExpressionType(expression, context.globals, context);
        if (!type) throw new Error(`${filename}: cannot infer GLSL type for constant ${name}`);
        return `${declaration(type, name, "const ")} = ${expression};`;
    });
    return source;
}

function hoistGlobalInterfaces(source) {
    const declarations = [];
    source = source.replace(/^(?:uniform|attribute|varying)\s+[^;\n]+;/gm, (declaration) => {
        declarations.push(declaration);
        return "";
    });
    return declarations.length ? `${declarations.join("\n")}\n${source}` : source;
}

function rewriteCalls(source, callParams, transform) {
    const masked = maskComments(source);
    let output = "";
    for (let i = 0; i < source.length;) {
        if (!/[A-Za-z_]/.test(masked[i])) {
            output += source[i++];
            continue;
        }
        const start = i++;
        while (i < source.length && /[A-Za-z0-9_]/.test(masked[i])) i++;
        const name = masked.slice(start, i);
        let open = i;
        while (/\s/.test(masked[open] || "")) open++;
        if (masked[open] !== "(") {
            output += source.slice(start, i);
            continue;
        }
        const close = matching(masked, open, "(", ")");
        if (close < 0) {
            output += source.slice(start, i);
            continue;
        }
        const args = splitTopLevel(source.slice(open + 1, close))
            .map((arg) => rewriteCalls(arg, callParams, transform));
        // `transform` already emits the call name. Keeping the source prefix
        // here duplicates every identifier (including function declarations).
        output += transform(name, args, callParams.get(name) || []);
        i = close + 1;
    }
    return output;
}

function replaceTextureCalls(source) {
    const textureCallParams = new Map([
        ["textureSample", [1]],
        ["textureSampleLevel", [1]],
        ["textureSampleGrad", [1]],
    ]);
    return rewriteCalls(source, textureCallParams, (name, args) => {
        if (name === "textureSample") return `texture(${args[0]}, ${args[2]})`;
        if (name === "textureSampleLevel") return `textureLod(${args[0]}, ${args[2]}, ${args[3]})`;
        if (name === "textureSampleGrad") return `textureGrad(${args[0]}, ${args[2]}, ${args[3]}, ${args[4]})`;
        if (name === "textureLoad") return `texelFetch(${args[0]}, ${args[1]}, ${args[2]})`;
        if (name === "textureDimensions") return `textureSize(${args[0]}, 0)`;
        return `${name}(${args.join(", ")})`;
    });
}

function replaceTypeAliases(source) {
    for (const [from, to] of TYPE_ALIASES) source = source.replace(new RegExp(`\\b${from}\\b`, "g"), to);
    source = source.replace(/\bvec([234])\s*<\s*f32\s*>/g, "vec$1");
    source = source.replace(/\bvec([234])\s*<\s*i32\s*>/g, "ivec$1");
    source = source.replace(/\bvec([234])\s*<\s*u32\s*>/g, "uvec$1");
    source = source.replace(/\bvec([234])\s*<\s*bool\s*>/g, "bvec$1");
    source = source.replace(/\bmat([234])x([234])f\b/g, "mat$1x$2");
    source = source.replace(/\barray\s*<\s*(\w+)\s*,\s*(\d+)\s*>\s*\(/g, "$1[$2](");
    source = source.replace(/\buniforms\.(\w+)\b/g, "$1");
    source = source.replace(/\bselect\s*\(/g, "wgslSelect(");
    source = source.replace(/\binverseSqrt\b/g, "inversesqrt");
    source = source.replace(/\bdpdx\b/g, "dFdx").replace(/\bdpdy\b/g, "dFdy");
    source = source.replace(/\batan2\s*\(/g, "atan(");
    return source;
}

function compatibilityFunctions() {
    const lines = [];
    for (const type of ["float", "int", "uint", "bool", "vec2", "vec3", "vec4", "ivec2", "ivec3", "ivec4", "uvec2", "uvec3", "uvec4", "bvec2", "bvec3", "bvec4"]) {
        lines.push(`${type} wgslSelect(${type} a, ${type} b, bool chooseB) { return chooseB ? b : a; }`);
    }
    for (const [type, mask, components] of [
        ["vec2", "bvec2", ["x", "y"]], ["vec3", "bvec3", ["x", "y", "z"]], ["vec4", "bvec4", ["x", "y", "z", "w"]],
        ["ivec2", "bvec2", ["x", "y"]], ["ivec3", "bvec3", ["x", "y", "z"]], ["ivec4", "bvec4", ["x", "y", "z", "w"]],
        ["uvec2", "bvec2", ["x", "y"]], ["uvec3", "bvec3", ["x", "y", "z"]], ["uvec4", "bvec4", ["x", "y", "z", "w"]],
        ["bvec2", "bvec2", ["x", "y"]], ["bvec3", "bvec3", ["x", "y", "z"]], ["bvec4", "bvec4", ["x", "y", "z", "w"]],
    ]) {
        const selected = components.map((component) => `chooseB.${component} ? b.${component} : a.${component}`).join(", ");
        lines.push(`${type} wgslSelect(${type} a, ${type} b, ${mask} chooseB) { return ${type}(${selected}); }`);
    }
    return `${lines.join("\n")}\n`;
}

function replaceVectorComparisons(source) {
    // WGSL comparisons on vectors produce a boolean vector. GLSL's direct
    // equality operators collapse that to one bool, so preserve the component
    // result when the expression is consumed by any/all.
    const aggregateCompare = /\b(any|all)\s*\(\s*([^()]+?)\s*(<=|>=|==|!=|<|>)\s*([^()]+?)\s*\)/g;
    source = source.replace(aggregateCompare, (_whole, aggregate, left, op, right) => {
        const fn = { "<": "lessThan", ">": "greaterThan", "<=": "lessThanEqual", ">=": "greaterThanEqual", "==": "equal", "!=": "notEqual" }[op];
        return `${aggregate}(${fn}(${left.trim()}, ${right.trim()}))`;
    });
    // WGSL allows relational operators on vectors. GLSL ES expresses the same
    // component-wise tests with lessThan/greaterThan family builtins.
    const operand = "(?:[A-Za-z_]\\w*\\s*\\([^()]*\\)|[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*(?:\\[[^\\]]+\\])?)";
    const compareRe = new RegExp(`(${operand})\\s*(<=|>=|==|!=|<|>)\\s*(vec[234]\\s*\\([^()]*\\))`, "g");
    return source.replace(compareRe, (_whole, left, op, right) => {
        const fn = { "<": "lessThan", ">": "greaterThan", "<=": "lessThanEqual", ">=": "greaterThanEqual", "==": "equal", "!=": "notEqual" }[op];
        return `${fn}(${left}, ${right})`;
    });
}

export function createWgslTypeContext(sources) {
    return makeTypeContext(sources);
}

export function wgslToGlsl(source, context, filename = "WGSL shader") {
    let output = convertStructDeclarations(source);
    output = convertFunctionDefinitions(output, context, filename);
    output = replaceGlobalDeclarations(output, context, filename);
    output = hoistGlobalInterfaces(output);
    output = output.replace(/@(vertex|fragment)\b/g, "");
    output = replaceTypeAliases(output);
    output = replaceTextureCalls(output);
    output = replaceVectorComparisons(output);
    // `out` is legal as a WGSL local/struct value name but reserved as a GLSL
    // storage qualifier. Keep the original name in a safe private identifier.
    output = output.replace(/\bout\b/g, "_wgsl_out");
    output = output
        .replace(/\bvertexInputs\.(\w+)\b/g, "$1")
        .replace(/\bvertexOutputs\.(\w+)\b/g, "$1")
        .replace(/\bfragmentInputs\.(\w+)\b/g, "$1")
        .replace(/\binput\.(v\w+)\b/g, "$1");
    if (/@vertex|@fragment/.test(source)) output = `${compatibilityFunctions()}\n${output}`;
    return output;
}
