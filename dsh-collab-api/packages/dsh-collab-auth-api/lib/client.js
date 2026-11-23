window.__ModuleLoader__.load({id:"@local/dsh-collab-auth-api",factory:function(require){var module={exports:{}};var exports=module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client-entry.ts
var client_entry_exports = {};
__export(client_entry_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_entry_exports);

// lib/typert.remote-client.js
var import_zod = require("zod");

// ../typert/protocol/real/types/remote-info.js
function createTypertRemoteInfo(spec, zod) {
  return new RemoteInfo(spec, zod);
}
var RemoteInfo = class {
  spec;
  zod;
  index;
  constructor(spec, zod) {
    this.spec = spec;
    this.zod = zod;
  }
  get package() {
    return this.spec.package;
  }
  get descriptors() {
    return this.resolve().descriptors;
  }
  get methods() {
    return this.resolve().methods;
  }
  resolve() {
    if (this.index !== void 0)
      return this.index;
    const zod = this.zod;
    const descriptors = [];
    const methods = /* @__PURE__ */ Object.create(null);
    for (const [endpoint, definition] of Object.entries(this.spec.methods)) {
      const separator = endpoint.indexOf("/");
      const namespace = endpoint.slice(0, separator);
      const method = endpoint.slice(separator + 1);
      const parameters = definition.parameters.map((parameter) => ({ ...parameter, wire: parameter.wire ?? parameter.name }));
      const descriptor = {
        ...definition,
        id: `${this.spec.package}#${endpoint}`,
        namespace,
        method,
        parameters,
        result: definition.result.description === void 0 ? definition.result : new ResultValue(definition.result)
      };
      if (definition.invocation.kind === "direct") {
        const inputs = [];
        const direct = Object.assign(descriptor, {
          input(options) {
            const strict = options?.strict === true;
            return inputs[strict ? 1 : 0] ??= new NamedInput(parameters, strict, zod);
          },
          invoke(remote, input, signal) {
            const named = input;
            const values = parameters.map((parameter) => named[parameter.wire]);
            if (definition.cancellation !== void 0)
              values.push(signal);
            const receiver = Reflect.get(remote, namespace);
            const call = Reflect.get(receiver, method);
            return call.apply(receiver, values);
          }
        });
        methods[endpoint] = direct;
      }
      descriptors.push(descriptor);
    }
    return this.index = { descriptors, methods };
  }
};
function optional(parameter) {
  return parameter.source === "json" && parameter.acceptsUndefined === true;
}
var NamedInput = class {
  parameters;
  strict;
  zod;
  schema;
  projection;
  constructor(parameters, strict, zod) {
    this.parameters = parameters;
    this.strict = strict;
    this.zod = zod;
  }
  codec(parameter) {
    return this.strict ? parameter.strictCodec : parameter.codec;
  }
  create = () => this.schema ??= this.zod.strictObject(Object.fromEntries(this.parameters.map((parameter) => {
    const value = this.codec(parameter).create();
    return [parameter.wire, optional(parameter) ? value.optional() : value.nonoptional()];
  })));
  get jsonSchema() {
    return this.project().jsonSchema;
  }
  get jsonSchemaError() {
    return this.project().jsonSchemaError;
  }
  project() {
    if (this.projection !== void 0)
      return this.projection;
    const unavailable = this.parameters.find((parameter) => this.codec(parameter).jsonSchema === void 0);
    if (unavailable !== void 0) {
      return this.projection = { jsonSchemaError: this.codec(unavailable).jsonSchemaError ?? `No JSON Schema for parameter ${unavailable.wire}` };
    }
    return this.projection = {
      jsonSchema: {
        type: "object",
        properties: Object.fromEntries(this.parameters.map((parameter) => [parameter.wire, {
          ...this.codec(parameter).jsonSchema,
          ...parameter.description === void 0 ? {} : { description: parameter.description }
        }])),
        required: this.parameters.filter((parameter) => !optional(parameter)).map((parameter) => parameter.wire),
        additionalProperties: false
      }
    };
  }
};
var ResultValue = class {
  spec;
  projection;
  constructor(spec) {
    this.spec = spec;
  }
  get mode() {
    return this.spec.mode;
  }
  get typeSymbol() {
    return this.spec.typeSymbol;
  }
  get create() {
    return this.spec.create;
  }
  get decode() {
    return this.spec.decode;
  }
  get encode() {
    return this.spec.encode;
  }
  get description() {
    return this.spec.description;
  }
  get jsonSchemaError() {
    return this.spec.jsonSchemaError;
  }
  get jsonSchema() {
    if (this.projection === void 0) {
      const schema = this.spec.jsonSchema;
      this.projection = { value: schema === void 0 ? void 0 : { ...schema, description: this.spec.description } };
    }
    return this.projection.value;
  }
};

// lib/typert.remote-client.js
var _local_dsh_collab_auth_api_collabAuth_authorize_parameter_0$schema$value;
var _local_dsh_collab_auth_api_collabAuth_authorize_parameter_0$schema = () => _local_dsh_collab_auth_api_collabAuth_authorize_parameter_0$schema$value ??= import_zod.z.string();
var _local_dsh_collab_auth_api_collabAuth_authorize_parameter_1$schema$value;
var _local_dsh_collab_auth_api_collabAuth_authorize_parameter_1$schema = () => _local_dsh_collab_auth_api_collabAuth_authorize_parameter_1$schema$value ??= import_zod.z.string();
var _local_dsh_collab_auth_api_collabAuth_authorize_result$schema$value;
var _local_dsh_collab_auth_api_collabAuth_authorize_result$schema = () => _local_dsh_collab_auth_api_collabAuth_authorize_result$schema$value ??= import_zod.z.object({
  "pairs": import_zod.z.array(import_zod.z.object({
    "a": import_zod.z.string().readonly().describe("First Session id in the pair."),
    "b": import_zod.z.string().readonly().describe("Second Session id in the pair."),
    "createdAt": import_zod.z.number().readonly().describe("Creation time in epoch milliseconds."),
    "updatedAt": import_zod.z.number().readonly().describe("Last update time in epoch milliseconds.")
  })).readonly().describe("Fully authorized pairs."),
  "pending": import_zod.z.array(import_zod.z.object({
    "from": import_zod.z.string().readonly().describe("Granting Session id."),
    "to": import_zod.z.string().readonly().describe("Receiving Session id."),
    "createdAt": import_zod.z.number().readonly().describe("Creation time in epoch milliseconds."),
    "updatedAt": import_zod.z.number().readonly().describe("Last update time in epoch milliseconds.")
  })).readonly().describe("Directional grants waiting for the other side.")
});
var _local_dsh_collab_auth_api_collabAuth_list_result$schema$value;
var _local_dsh_collab_auth_api_collabAuth_list_result$schema = () => _local_dsh_collab_auth_api_collabAuth_list_result$schema$value ??= import_zod.z.object({
  "pairs": import_zod.z.array(import_zod.z.object({
    "a": import_zod.z.string().readonly().describe("First Session id in the pair."),
    "b": import_zod.z.string().readonly().describe("Second Session id in the pair."),
    "createdAt": import_zod.z.number().readonly().describe("Creation time in epoch milliseconds."),
    "updatedAt": import_zod.z.number().readonly().describe("Last update time in epoch milliseconds.")
  })).readonly().describe("Fully authorized pairs."),
  "pending": import_zod.z.array(import_zod.z.object({
    "from": import_zod.z.string().readonly().describe("Granting Session id."),
    "to": import_zod.z.string().readonly().describe("Receiving Session id."),
    "createdAt": import_zod.z.number().readonly().describe("Creation time in epoch milliseconds."),
    "updatedAt": import_zod.z.number().readonly().describe("Last update time in epoch milliseconds.")
  })).readonly().describe("Directional grants waiting for the other side.")
});
var _local_dsh_collab_auth_api_collabAuth_panel_parameter_0$schema$value;
var _local_dsh_collab_auth_api_collabAuth_panel_parameter_0$schema = () => _local_dsh_collab_auth_api_collabAuth_panel_parameter_0$schema$value ??= import_zod.z.string();
var _local_dsh_collab_auth_api_collabAuth_panel_parameter_1$schema$value;
var _local_dsh_collab_auth_api_collabAuth_panel_parameter_1$schema = () => _local_dsh_collab_auth_api_collabAuth_panel_parameter_1$schema$value ??= import_zod.z.string();
var _local_dsh_collab_auth_api_collabAuth_panel_parameter_2$schema$value;
var _local_dsh_collab_auth_api_collabAuth_panel_parameter_2$schema = () => _local_dsh_collab_auth_api_collabAuth_panel_parameter_2$schema$value ??= import_zod.z.string();
var _local_dsh_collab_auth_api_collabAuth_panel_result$schema$value;
var _local_dsh_collab_auth_api_collabAuth_panel_result$schema = () => _local_dsh_collab_auth_api_collabAuth_panel_result$schema$value ??= import_zod.z.string();
var _local_dsh_collab_auth_api_collabAuth_revoke_parameter_0$schema$value;
var _local_dsh_collab_auth_api_collabAuth_revoke_parameter_0$schema = () => _local_dsh_collab_auth_api_collabAuth_revoke_parameter_0$schema$value ??= import_zod.z.string();
var _local_dsh_collab_auth_api_collabAuth_revoke_parameter_1$schema$value;
var _local_dsh_collab_auth_api_collabAuth_revoke_parameter_1$schema = () => _local_dsh_collab_auth_api_collabAuth_revoke_parameter_1$schema$value ??= import_zod.z.string();
var _local_dsh_collab_auth_api_collabAuth_revoke_result$schema$value;
var _local_dsh_collab_auth_api_collabAuth_revoke_result$schema = () => _local_dsh_collab_auth_api_collabAuth_revoke_result$schema$value ??= import_zod.z.object({
  "pairs": import_zod.z.array(import_zod.z.object({
    "a": import_zod.z.string().readonly().describe("First Session id in the pair."),
    "b": import_zod.z.string().readonly().describe("Second Session id in the pair."),
    "createdAt": import_zod.z.number().readonly().describe("Creation time in epoch milliseconds."),
    "updatedAt": import_zod.z.number().readonly().describe("Last update time in epoch milliseconds.")
  })).readonly().describe("Fully authorized pairs."),
  "pending": import_zod.z.array(import_zod.z.object({
    "from": import_zod.z.string().readonly().describe("Granting Session id."),
    "to": import_zod.z.string().readonly().describe("Receiving Session id."),
    "createdAt": import_zod.z.number().readonly().describe("Creation time in epoch milliseconds."),
    "updatedAt": import_zod.z.number().readonly().describe("Last update time in epoch milliseconds.")
  })).readonly().describe("Directional grants waiting for the other side.")
});
var _local_dsh_collab_auth_api_collabAuth_authorize_parameter_0_strict$schema$value;
var _local_dsh_collab_auth_api_collabAuth_authorize_parameter_0_strict$schema = () => _local_dsh_collab_auth_api_collabAuth_authorize_parameter_0_strict$schema$value ??= import_zod.z.string();
var _local_dsh_collab_auth_api_collabAuth_authorize_parameter_1_strict$schema$value;
var _local_dsh_collab_auth_api_collabAuth_authorize_parameter_1_strict$schema = () => _local_dsh_collab_auth_api_collabAuth_authorize_parameter_1_strict$schema$value ??= import_zod.z.string();
var _local_dsh_collab_auth_api_collabAuth_panel_parameter_0_strict$schema$value;
var _local_dsh_collab_auth_api_collabAuth_panel_parameter_0_strict$schema = () => _local_dsh_collab_auth_api_collabAuth_panel_parameter_0_strict$schema$value ??= import_zod.z.string();
var _local_dsh_collab_auth_api_collabAuth_panel_parameter_1_strict$schema$value;
var _local_dsh_collab_auth_api_collabAuth_panel_parameter_1_strict$schema = () => _local_dsh_collab_auth_api_collabAuth_panel_parameter_1_strict$schema$value ??= import_zod.z.string();
var _local_dsh_collab_auth_api_collabAuth_panel_parameter_2_strict$schema$value;
var _local_dsh_collab_auth_api_collabAuth_panel_parameter_2_strict$schema = () => _local_dsh_collab_auth_api_collabAuth_panel_parameter_2_strict$schema$value ??= import_zod.z.string();
var _local_dsh_collab_auth_api_collabAuth_revoke_parameter_0_strict$schema$value;
var _local_dsh_collab_auth_api_collabAuth_revoke_parameter_0_strict$schema = () => _local_dsh_collab_auth_api_collabAuth_revoke_parameter_0_strict$schema$value ??= import_zod.z.string();
var _local_dsh_collab_auth_api_collabAuth_revoke_parameter_1_strict$schema$value;
var _local_dsh_collab_auth_api_collabAuth_revoke_parameter_1_strict$schema = () => _local_dsh_collab_auth_api_collabAuth_revoke_parameter_1_strict$schema$value ??= import_zod.z.string();
var TYPERT_REMOTE = createTypertRemoteInfo({
  package: "@local/dsh-collab-auth-api",
  methods: {
    "collabAuth/authorize": {
      service: "collabAuth",
      description: "Authorize both directions of a pair.",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "a",
          description: "first Session id.",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@local/dsh-collab-auth-api#collabAuth/authorize:a",
            create: _local_dsh_collab_auth_api_collabAuth_authorize_parameter_0$schema,
            jsonSchema: { "type": "string" }
          },
          strictCodec: {
            mode: "strict",
            typeSymbol: "@local/dsh-collab-auth-api#collabAuth/authorize:a",
            create: _local_dsh_collab_auth_api_collabAuth_authorize_parameter_0_strict$schema,
            jsonSchema: { "type": "string" }
          }
        },
        {
          name: "b",
          description: "second Session id.",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@local/dsh-collab-auth-api#collabAuth/authorize:b",
            create: _local_dsh_collab_auth_api_collabAuth_authorize_parameter_1$schema,
            jsonSchema: { "type": "string" }
          },
          strictCodec: {
            mode: "strict",
            typeSymbol: "@local/dsh-collab-auth-api#collabAuth/authorize:b",
            create: _local_dsh_collab_auth_api_collabAuth_authorize_parameter_1_strict$schema,
            jsonSchema: { "type": "string" }
          }
        }
      ],
      result: {
        mode: "strict",
        typeSymbol: "@local/dsh-collab-auth-api/types#AuthSnapshot",
        create: _local_dsh_collab_auth_api_collabAuth_authorize_result$schema,
        description: "the resulting authorization snapshot.",
        jsonSchema: { "type": "object", "properties": { "pairs": { "type": "array", "items": { "type": "object", "properties": { "a": { "type": "string", "description": "First Session id in the pair." }, "b": { "type": "string", "description": "Second Session id in the pair." }, "createdAt": { "type": "number", "description": "Creation time in epoch milliseconds." }, "updatedAt": { "type": "number", "description": "Last update time in epoch milliseconds." } }, "required": ["a", "b", "createdAt", "updatedAt"], "additionalProperties": true }, "description": "Fully authorized pairs." }, "pending": { "type": "array", "items": { "type": "object", "properties": { "from": { "type": "string", "description": "Granting Session id." }, "to": { "type": "string", "description": "Receiving Session id." }, "createdAt": { "type": "number", "description": "Creation time in epoch milliseconds." }, "updatedAt": { "type": "number", "description": "Last update time in epoch milliseconds." } }, "required": ["from", "to", "createdAt", "updatedAt"], "additionalProperties": true }, "description": "Directional grants waiting for the other side." } }, "required": ["pairs", "pending"], "additionalProperties": true }
      },
      sourceLocation: { "file": "packages/dsh-collab-auth-api/src/index.ts", "line": 64, "column": 3 }
    },
    "collabAuth/list": {
      service: "collabAuth",
      description: "Read entirely authorized pairs and one-sided pending grants.",
      invocation: { kind: "direct" },
      parameters: [],
      result: {
        mode: "strict",
        typeSymbol: "@local/dsh-collab-auth-api/types#AuthSnapshot",
        create: _local_dsh_collab_auth_api_collabAuth_list_result$schema,
        description: "the current authorization snapshot.",
        jsonSchema: { "type": "object", "properties": { "pairs": { "type": "array", "items": { "type": "object", "properties": { "a": { "type": "string", "description": "First Session id in the pair." }, "b": { "type": "string", "description": "Second Session id in the pair." }, "createdAt": { "type": "number", "description": "Creation time in epoch milliseconds." }, "updatedAt": { "type": "number", "description": "Last update time in epoch milliseconds." } }, "required": ["a", "b", "createdAt", "updatedAt"], "additionalProperties": true }, "description": "Fully authorized pairs." }, "pending": { "type": "array", "items": { "type": "object", "properties": { "from": { "type": "string", "description": "Granting Session id." }, "to": { "type": "string", "description": "Receiving Session id." }, "createdAt": { "type": "number", "description": "Creation time in epoch milliseconds." }, "updatedAt": { "type": "number", "description": "Last update time in epoch milliseconds." } }, "required": ["from", "to", "createdAt", "updatedAt"], "additionalProperties": true }, "description": "Directional grants waiting for the other side." } }, "required": ["pairs", "pending"], "additionalProperties": true }
      },
      sourceLocation: { "file": "packages/dsh-collab-auth-api/src/index.ts", "line": 53, "column": 3 }
    },
    "collabAuth/panel": {
      service: "collabAuth",
      description: "Read or mutate the supervisor board/base-prompt surface without writing a slash-command lifecycle into the conversation.",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "sessionId",
          description: "collaboration Session id.",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@local/dsh-collab-auth-api#collabAuth/panel:sessionId",
            create: _local_dsh_collab_auth_api_collabAuth_panel_parameter_0$schema,
            jsonSchema: { "type": "string" }
          },
          strictCodec: {
            mode: "strict",
            typeSymbol: "@local/dsh-collab-auth-api#collabAuth/panel:sessionId",
            create: _local_dsh_collab_auth_api_collabAuth_panel_parameter_0_strict$schema,
            jsonSchema: { "type": "string" }
          }
        },
        {
          name: "operation",
          description: "board, baseGet, baseSet, link, unlink, pin, or live.",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@local/dsh-collab-auth-api#collabAuth/panel:operation",
            create: _local_dsh_collab_auth_api_collabAuth_panel_parameter_1$schema,
            jsonSchema: { "type": "string" }
          },
          strictCodec: {
            mode: "strict",
            typeSymbol: "@local/dsh-collab-auth-api#collabAuth/panel:operation",
            create: _local_dsh_collab_auth_api_collabAuth_panel_parameter_1_strict$schema,
            jsonSchema: { "type": "string" }
          }
        },
        {
          name: "argsJson",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@local/dsh-collab-auth-api#collabAuth/panel:argsJson",
            create: _local_dsh_collab_auth_api_collabAuth_panel_parameter_2$schema,
            jsonSchema: { "type": "string" }
          },
          strictCodec: {
            mode: "strict",
            typeSymbol: "@local/dsh-collab-auth-api#collabAuth/panel:argsJson",
            create: _local_dsh_collab_auth_api_collabAuth_panel_parameter_2_strict$schema,
            jsonSchema: { "type": "string" }
          }
        }
      ],
      result: {
        mode: "strict",
        typeSymbol: "@local/dsh-collab-auth-api#collabAuth/panel:result",
        create: _local_dsh_collab_auth_api_collabAuth_panel_result$schema,
        description: "the operation result.",
        jsonSchema: { "type": "string" }
      },
      sourceLocation: { "file": "packages/dsh-collab-auth-api/src/index.ts", "line": 88, "column": 3 }
    },
    "collabAuth/revoke": {
      service: "collabAuth",
      description: "Revoke both directions of a pair.",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "a",
          description: "first Session id.",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@local/dsh-collab-auth-api#collabAuth/revoke:a",
            create: _local_dsh_collab_auth_api_collabAuth_revoke_parameter_0$schema,
            jsonSchema: { "type": "string" }
          },
          strictCodec: {
            mode: "strict",
            typeSymbol: "@local/dsh-collab-auth-api#collabAuth/revoke:a",
            create: _local_dsh_collab_auth_api_collabAuth_revoke_parameter_0_strict$schema,
            jsonSchema: { "type": "string" }
          }
        },
        {
          name: "b",
          description: "second Session id.",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@local/dsh-collab-auth-api#collabAuth/revoke:b",
            create: _local_dsh_collab_auth_api_collabAuth_revoke_parameter_1$schema,
            jsonSchema: { "type": "string" }
          },
          strictCodec: {
            mode: "strict",
            typeSymbol: "@local/dsh-collab-auth-api#collabAuth/revoke:b",
            create: _local_dsh_collab_auth_api_collabAuth_revoke_parameter_1_strict$schema,
            jsonSchema: { "type": "string" }
          }
        }
      ],
      result: {
        mode: "strict",
        typeSymbol: "@local/dsh-collab-auth-api/types#AuthSnapshot",
        create: _local_dsh_collab_auth_api_collabAuth_revoke_result$schema,
        description: "the resulting authorization snapshot.",
        jsonSchema: { "type": "object", "properties": { "pairs": { "type": "array", "items": { "type": "object", "properties": { "a": { "type": "string", "description": "First Session id in the pair." }, "b": { "type": "string", "description": "Second Session id in the pair." }, "createdAt": { "type": "number", "description": "Creation time in epoch milliseconds." }, "updatedAt": { "type": "number", "description": "Last update time in epoch milliseconds." } }, "required": ["a", "b", "createdAt", "updatedAt"], "additionalProperties": true }, "description": "Fully authorized pairs." }, "pending": { "type": "array", "items": { "type": "object", "properties": { "from": { "type": "string", "description": "Granting Session id." }, "to": { "type": "string", "description": "Receiving Session id." }, "createdAt": { "type": "number", "description": "Creation time in epoch milliseconds." }, "updatedAt": { "type": "number", "description": "Last update time in epoch milliseconds." } }, "required": ["from", "to", "createdAt", "updatedAt"], "additionalProperties": true }, "description": "Directional grants waiting for the other side." } }, "required": ["pairs", "pending"], "additionalProperties": true }
      },
      sourceLocation: { "file": "packages/dsh-collab-auth-api/src/index.ts", "line": 75, "column": 3 }
    }
  }
}, import_zod.z);
var typert_remote_client_default = TYPERT_REMOTE;

// src/client-entry.ts
var inject = ["remote"];
function apply(ctx) {
  ctx.effect(() => ctx.remote.$mount(typert_remote_client_default), "collab-auth-api.remote");
}

return module.exports;}});
