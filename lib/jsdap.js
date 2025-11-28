/*
 * jsDAP 7.0.0, a JavaScript OPeNDAP client.
 *
 * You can find the uncompressed source at:
 *
 *   https://bitbucket.org/jetfuse/jsdap
 *
 * Copyright (c) 2007--2009 Roberto De Almeida
 */
var parser = {};

(function() {
    "use strict";
    var ATOMIC_TYPES = [ "byte", "int", "uint", "int16", "uint16", "int32", "uint32", "float32", "float64", "string", "url", "alias" ];
    var STRUCTURED_TYPES = [ "Sequence", "Structure", "Dataset" ];
    //Regular expressions
    //DDS parsing expressions
    var DDS_BASE_TYPE_DIMENSION_NAME_OR_VALUE_EXPRESSION = "(\\\\=|\\\\\\]|[^\\]=])+"; //Dimension name will end at the equals sign, or square bracket if value only
    var DDS_BASE_TYPE_DIMENSION_VALUE_EXPRESSION = "\\d+";
    var DDS_BASE_TYPE_EXPRESSION = "\\w+";
    var DDS_BASE_TYPE_NAME_EXPRESSION = "(\\\\;|\\\\\\[|[^\\[;])+"; //Type name ends with a square bracket or semicolon
    var DDS_DATASET_ID_EXPRESSION = "(\\\\;|[^;])+"; //Ends with a semicolon
    var DDS_NAME_EXPRESSION = "(\\\\;|[^;])+"; //Ends with a semicolon
    //DAS parsing expressions
    var DAS_ALIAS_EXPRESSION = '".*?[^\\\\]"|[^;,]+';
    var DAS_ATTRIBUTE_TYPE_EXPRESSION = "\\w+";
    var DAS_ATTRIBUTE_NAME_EXPRESSION = "(\\\\\\s|[^\\s])+"; //Ends with unescaped whitespace
    var DAS_CONTAINER_NAME_EXPRESSION = "(\\\\{|[^{])+";
    var DAS_METADATA_NAME_EXPRESSION = "(\\\\{|[^{])+";
    var DAS_NUMERICAL_EXPRESSION = '".*?[^\\\\]"|[^;,]+';
    var DAS_STRING_EXPRESSION = '"(\\\\\\\\|\\\\"|[^"])*"'; //Ends with a double quote
    var DAS_TYPE_EXPRESSION = "\\w+";
    var DAS_URL_EXPRESSION = '".*?[^\\\\]"|[^;,]+';
    Array.prototype.contains = function(item) {
        for (var i = 0, el = this[i]; i < this.length; el = this[++i]) {
            if (item === el) return true;
        }
        return false;
    };
    String.prototype.trim = function() {
        return this.replace(/^\s+|\s+$/g, "");
    };
    String.prototype.ltrim = function() {
        return this.replace(/^[\s\n\r\t]+/, "");
    };
    String.prototype.rtrim = function() {
        return this.replace(/\s+$/, "");
    };
    function pseudoSafeEval(str) {
        return eval("(" + str + ")");
    }
    //TODO: Should this be private?
    parser.dapType = function(type) {
        this.type = type;
        this.attributes = {};
    };
    function simpleParser(input) {
        this.stream = input;
        this.peek = function(expr) {
            var regExp = new RegExp("^" + expr, "i");
            var m = this.stream.match(regExp);
            if (m) {
                return m[0];
            } else {
                return "";
            }
        };
        this.consume = function(expr) {
            var regExp = new RegExp("^" + expr, "i");
            var m = this.stream.match(regExp);
            if (m) {
                this.stream = this.stream.substr(m[0].length).ltrim();
                return m[0];
            } else {
                throw new Error("Unable to parse stream: " + this.stream.substr(0, 10));
            }
        };
    }
    parser.ddsParser = function(dds) {
        this.stream = dds;
        this._dataset = function() {
            var dataset = new parser.dapType("Dataset");
            this.consume("dataset");
            this.consume("{");
            while (!this.peek("}")) {
                var declaration = this._declaration();
                dataset[declaration.name] = declaration;
            }
            this.consume("}");
            dataset.id = dataset.name = this.consume(DDS_DATASET_ID_EXPRESSION).trim();
            this.consume(";");
            // Set id.
            function walk(dapvar, includeParent) {
                for (var attr in dapvar) {
                    var child = dapvar[attr];
                    if (child.type) {
                        child.id = child.name;
                        if (includeParent) {
                            child.id = dapvar.id + "." + child.id;
                        }
                        walk(child, true);
                    }
                }
            }
            walk(dataset, false);
            return dataset;
        };
        this.parse = this._dataset;
        this._declaration = function() {
            var type = this.peek(DDS_BASE_TYPE_EXPRESSION).toLowerCase();
            switch (type) {
              case "grid":
                return this._grid();

              case "structure":
                return this._structure("Structure");

              case "sequence":
                return this._structure("Sequence");

              default:
                return this._base_declaration();
            }
        };
        this._base_declaration = function() {
            var baseType = new parser.dapType();
            baseType.type = this.consume(DDS_BASE_TYPE_EXPRESSION).trim();
            baseType.name = this.consume(DDS_BASE_TYPE_NAME_EXPRESSION).trim();
            baseType.dimensions = [];
            baseType.shape = [];
            while (!this.peek(";")) {
                this.consume("\\[");
                var token = this.consume(DDS_BASE_TYPE_DIMENSION_NAME_OR_VALUE_EXPRESSION).trim();
                if (this.peek("=")) {
                    baseType.dimensions.push(token);
                    this.consume("=");
                    token = this.consume(DDS_BASE_TYPE_DIMENSION_VALUE_EXPRESSION).trim();
                }
                baseType.shape.push(parseInt(token));
                this.consume("\\]");
            }
            this.consume(";");
            return baseType;
        };
        this._grid = function() {
            var grid = new parser.dapType("Grid");
            this.consume("grid");
            this.consume("{");
            this.consume("array");
            this.consume(":");
            grid.array = this._base_declaration();
            this.consume("maps");
            this.consume(":");
            grid.maps = {};
            while (!this.peek("}")) {
                var map_ = this._base_declaration();
                grid.maps[map_.name] = map_;
            }
            this.consume("}");
            grid.name = this._name();
            return grid;
        };
        this._structure = function(type) {
            var structure = new parser.dapType(type);
            this.consume(type);
            this.consume("{");
            while (!this.peek("}")) {
                var declaration = this._declaration();
                structure[declaration.name] = declaration;
            }
            this.consume("}");
            structure.name = this._name();
            return structure;
        };
        this._name = function() {
            var name = this.consume(DDS_NAME_EXPRESSION).trim();
            this.consume(";");
            return name;
        };
    };
    parser.ddsParser.prototype = new simpleParser();
    parser.dasParser = function(das, dataset) {
        this.stream = das;
        this.dataset = dataset;
        this.parse = function() {
            this._target = this.dataset;
            this.consume("attributes");
            this.consume("{");
            while (!this.peek("}")) {
                this._attr_container();
            }
            this.consume("}");
            return this.dataset;
        };
        this._attr_container = function() {
            if (ATOMIC_TYPES.contains(this.peek(DAS_TYPE_EXPRESSION).toLowerCase())) {
                this._attribute(this._target.attributes);
                if (this._target.type === "Grid") {
                    for (var map in this._target.maps) {
                        if (this.dataset[map]) {
                            var target_map = this._target.maps[map];
                            for (var name in target_map.attributes) {
                                this.dataset[map].attributes[name] = target_map.attributes[name];
                            }
                        }
                    }
                }
            } else {
                this._container();
            }
        };
        this._container = function() {
            var name = this.consume(DAS_CONTAINER_NAME_EXPRESSION).trim();
            this.consume("{");
            var target;
            if (name.indexOf(".") > -1) {
                var names = name.split(".");
                target = this._target;
                for (var i = 0; i < names.length; i++) {
                    this._target = this._target[names[i]];
                }
                while (!this.peek("}")) {
                    this._attr_container();
                }
                this.consume("}");
                this._target = target;
            } else if (STRUCTURED_TYPES.contains(this._target.type) && this._target[name]) {
                target = this._target;
                this._target = target[name];
                while (!this.peek("}")) {
                    this._attr_container();
                }
                this.consume("}");
                this._target = target;
            } else {
                this._target.attributes[name] = this._metadata();
                this.consume("}");
            }
        };
        this._metadata = function() {
            var output = {};
            while (!this.peek("}")) {
                if (ATOMIC_TYPES.contains(this.peek(DAS_TYPE_EXPRESSION).toLowerCase())) {
                    this._attribute(output);
                } else {
                    var name = this.consume(DAS_METADATA_NAME_EXPRESSION).trim();
                    this.consume("{");
                    output[name] = this._metadata();
                    this.consume("}");
                }
            }
            return output;
        };
        this._attribute = function(object) {
            var type = this.consume(DAS_ATTRIBUTE_TYPE_EXPRESSION).trim();
            var name = this.consume(DAS_ATTRIBUTE_NAME_EXPRESSION).trim();
            var value;
            var values = [];
            while (!this.peek(";")) {
                if (type.toLowerCase() === "string") {
                    value = this.consume(DAS_STRING_EXPRESSION).trim();
                    // trim the double quotes from the match
                    value = value.substr(1, value.length - 2);
                } else if (type.toLowerCase() === "url") {
                    value = this.consume(DAS_URL_EXPRESSION).trim();
                } else if (type.toLowerCase() === "alias") {
                    var target, tokens;
                    value = this.consume(DAS_ALIAS_EXPRESSION).trim();
                    if (value.match(/^\\./)) {
                        tokens = value.substring(1).split(".");
                        target = this.dataset;
                    } else {
                        tokens = value.split(".");
                        target = this._target;
                    }
                    for (var i = 0; i < tokens.length; i++) {
                        var token = tokens[i];
                        if (target[token]) {
                            target = target[token];
                        } else if (target.array.name === token) {
                            target = target.array;
                        } else if (target.maps[token]) {
                            target = target.maps[token];
                        } else {
                            target = target.attributes[token];
                        }
                        value = target;
                    }
                } else {
                    value = this.consume(DAS_NUMERICAL_EXPRESSION).trim();
                    if (value.toLowerCase() === "nan") {
                        value = NaN;
                    } else if (value.toLowerCase() === "inf") {
                        value = Infinity;
                    } else if (value.toLowerCase() === "-inf") {
                        value = -Infinity;
                    } else {
                        value = pseudoSafeEval(value);
                    }
                }
                values.push(value);
                if (this.peek(",")) {
                    this.consume(",");
                }
            }
            this.consume(";");
            if (values.length === 1) {
                values = values[0];
            }
            object[name] = values;
        };
    };
    parser.dasParser.prototype = new simpleParser();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = parser;
    }
})();

var xdr = {};

(function() {
    "use strict";
    var END_OF_SEQUENCE = "¥\0\0\0";
    var START_OF_SEQUENCE = "Z\0\0\0";
    xdr.dapUnpacker = function(xdrdata, dapvar) {
        this._buf = xdrdata;
        this._view = new DataView(this._buf); //Get a view into the ArrayBuffer
        this.dapvar = dapvar;
        this._pos = 0; //Byte offset
        this.getValue = function() {
            var type = this.dapvar.type.toLowerCase();
            if (type === "structure" || type === "dataset") {
                return this._parse_structure();
            } else if (type === "grid") {
                return this._parse_grid();
            } else if (type === "sequence") {
                return this._parse_sequence();
            } else if (this._buf.slice(this._pos, this._pos + 4) === START_OF_SEQUENCE) {
                return this._parse_base_type_sequence();
            } else {
                return this._parse_base_type(type);
            }
        };
        this._parse_structure = function() {
            var out = {};
            var tmp;
            var dapvar = this.dapvar;
            for (var child in dapvar) {
                if (dapvar[child].type) {
                    this.dapvar = dapvar[child];
                    tmp = this.getValue();
                    out[child] = tmp;
                }
            }
            this.dapvar = dapvar;
            return out;
        };
        this._parse_grid = function() {
            var out = [];
            var tmp;
            var dapvar = this.dapvar;
            this.dapvar = dapvar.array;
            tmp = this.getValue();
            out.push(tmp);
            for (var map in dapvar.maps) {
                if (dapvar.maps[map].type) {
                    this.dapvar = dapvar.maps[map];
                    tmp = this.getValue();
                    out.push(tmp);
                }
            }
            this.dapvar = dapvar;
            return out;
        };
        this._parse_sequence = function() {
            var out = [];
            var tmp;
            var mark = this._unpack_uint32();
            var dapvar = this.dapvar;
            while (mark !== 2768240640) {
                var struct = [];
                for (var child in dapvar) {
                    if (dapvar[child].type) {
                        this.dapvar = dapvar[child];
                        tmp = this.getValue();
                        struct.push(tmp);
                    }
                }
                out.push(struct);
                mark = this._unpack_uint32();
            }
            this.dapvar = dapvar;
            return out;
        };
        this._parse_base_type_sequence = function() {
            // This is a request for a base type variable inside a sequence.
            var out = [];
            var tmp;
            var mark = this._unpack_uint32();
            while (mark !== 2768240640) {
                tmp = this.getValue();
                out.push(tmp);
                mark = this._unpack_uint32();
            }
            return out;
        };
        this._parse_base_type = function(type) {
            //Numeric or string type
            var out = [];
            var n = 1;
            if (this.dapvar.shape.length) {
                n = this._unpack_uint32();
                if (type !== "url" && type !== "string") {
                    this._unpack_uint32(); //Throw away a start?
                }
            }
            if (type === "byte") {
                out = this._unpack_bytes(n);
            } else if (type === "url" || type === "string") {
                out = this._unpack_string(n);
            } else {
                out = [];
                var func;
                switch (type) {
                  case "float64":
                    func = "_unpack_float64";
                    out = new Float64Array(n);
                    break;

                  case "float32":
                    func = "_unpack_float32";
                    out = new Float32Array(n);
                    break;

                  case "int":
                  case "int32":
                    func = "_unpack_int32";
                    out = new Int32Array(n);
                    break;

                  case "uint":
                  case "uint32":
                    func = "_unpack_uint32";
                    out = new Uint32Array(n);
                    break;

                  case "int16":
                    func = "_unpack_int32";
                    out = new Int16Array(n);
                    break;

                  case "uint16":
                    func = "_unpack_uint32";
                    out = new Uint16Array(n);
                    break;

                  case "int8":
                    func = "_unpack_int32";
                    out = new Int8Array(n);
                    break;

                  case "uint8":
                    func = "_unpack_uint32";
                    out = new Uint8Array(n);
                    break;
                }
                for (var i = 0; i < n; i++) {
                    out[i] = this[func]();
                }
            }
            if (this.dapvar.shape) {
                out = reshape(out, this.dapvar.shape);
            } else {
                out = out[0];
            }
            return out;
        };
        this._unpack_byte = function() {
            var startPos = this._pos;
            this._pos += 1; //Increment the byte counter
            return this._view.getUint8(startPos);
        };
        this._unpack_uint32 = function() {
            var startPos = this._pos;
            this._pos += 4; //Increment the byte counter
            return this._view.getUint32(startPos);
        };
        this._unpack_int32 = function() {
            var startPos = this._pos;
            this._pos += 4; //Increment the byte counter
            return this._view.getInt32(startPos);
        };
        this._unpack_float32 = function() {
            var startPos = this._pos;
            this._pos += 4; //Increment the byte counter
            return this._view.getFloat32(startPos);
        };
        this._unpack_float64 = function() {
            var startPos = this._pos;
            this._pos += 8; //Increment the byte counter
            return this._view.getFloat64(startPos);
        };
        this._unpack_bytes = function(count) {
            var padding = (4 - count % 4) % 4;
            var bytes = [];
            for (var c = 0; c < count; c++) {
                bytes.push(this._unpack_byte());
            }
            this._pos += padding;
            return bytes;
        };
        this._unpack_string = function(count) {
            var strings = [];
            for (var c = 0; c < count; c++) {
                var n = this._unpack_uint32(); //Length of the string
                var padding = (4 - n % 4) % 4;
                var str = "";
                for (var s = 0; s < n; s++) {
                    str += String.fromCharCode(this._unpack_byte());
                }
                strings.push(str);
                this._pos += padding;
            }
            return strings;
        };
    };
    var reshape = function(array, shape) {
        if (!shape.length) return array[0];
        if (shape.length === 1) return array.slice(0, shape[0]);
        var out = [];
        var size, start, stop;
        for (var i = 0; i < shape[0]; i++) {
            size = array.length / shape[0];
            start = i * size;
            stop = start + size;
            out.push(reshape(array.slice(start, stop), shape.slice(1)));
        }
        return out;
    };
    if (typeof module !== "undefined" && module.exports) {
        module.exports = xdr;
    }
})();

var jsdap = {};

if (typeof require !== "undefined" && module.exports) {
    var parser = require("./parser");
    var xdr = require("./xdr");
    //Workaround infinite recursion when jsdap is included in a webpack project
    if (typeof XMLHttpRequest === "undefined") {
        var XMLHttpRequest = require("xhr2");
    }
}

(function() {
    "use strict";
    jsdap.newRequest = function(url, binary) {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        if (binary) {
            xhr.responseType = "arraybuffer";
        } else {
            if (xhr.overrideMimeType) {
                xhr.overrideMimeType("text/plain; charset=x-user-defined");
            } else {
                xhr.setRequestHeader("Accept-Charset", "x-user-defined");
            }
        }
        return xhr;
    };
    jsdap.dodsRequestHandler = function(xhr) {
        var dods = xhr.responseBody || xhr.response || xhr.mozResponseArrayBuffer; //FF5
        var dataStart = "\nData:\n";
        var view = new DataView(dods);
        var byteIndex = 0;
        var dds = ""; //The DDS string
        while (byteIndex < view.byteLength) {
            dds += String.fromCharCode(view.getUint8(byteIndex));
            if (dds.indexOf(dataStart) !== -1) {
                break;
            }
            byteIndex += 1;
        }
        dds = dds.substr(0, dds.length - dataStart.length); //Remove the start of data string '\nData:\n'
        dods = dods.slice(byteIndex + 1); //Split off the DDS data
        var dapvar = new parser.ddsParser(dds).parse();
        var data = new xdr.dapUnpacker(dods, dapvar).getValue();
        //Return an object containing the DDS for the requested data, as well as the requested data
        return {
            dds: dapvar,
            data: data
        };
    };
    jsdap.ddsRequestHandler = function(xhr) {
        const dds = xhr.responseText;
        return new parser.ddsParser(dds).parse();
    };
    jsdap.dasRequestHandler = function(xhr, dds = {
        type: "Dataset",
        attributes: {}
    }) {
        const das = xhr.responseText;
        return new parser.dasParser(das, dds).parse();
    };
    jsdap.loadDataAndDDS = function(url, onLoad, onError, onAbort, onProgress, onTimeout) {
        var dodsReq = jsdap.newRequest(url, true);
        dodsReq.onload = function() {
            if (dodsReq.status == 200)
                onLoad(jsdap.dodsRequestHandler(dodsReq));
        };
        dodsReq.onerror = onError;
        dodsReq.onabort = onAbort;
        dodsReq.onprogress = onProgress;
        dodsReq.ontimeout = onTimeout;
        dodsReq.onloadend = function() {
            if(dodsReq.status != 200) 
                onError(dodsReq.status);
        }
        dodsReq.send(null);
    };
    jsdap.loadDDS = function(url, onLoad, onError, onAbort, onProgress, onTimeout) {
        var ddsReq = jsdap.newRequest(url);
        ddsReq.onLoad = function() {
            onLoad(jsdap.ddsRequestHandler(ddsReq));
        };
        ddsReq.onerror = onError;
        ddsReq.onabort = onAbort;
        ddsReq.onprogress = onProgress;
        ddsReq.ontimeout = onTimeout;
        ddsReq.send(null);
    };
    jsdap.loadDAS = function(url, dds, onLoad, onError, onAbort, onProgress, onTimeout) {
        var dasReq = jsdap.newRequest(url);
        dasReq.onload = function() {
            onLoad(jsdap.dasRequestHandler(dasReq, dds));
        };
        dasReq.onerror = onError;
        dasReq.onabort = onAbort;
        dasReq.onprogress = onProgress;
        dasReq.ontimeout = onTimeout;
        dasReq.send(null);
    };
    jsdap.loadData = function(url, onLoad, onError, onAbort, onProgress, onTimeout) {
        jsdap.loadDataAndDDS(url, function(dods) {
            //Return only data
            return onLoad(dods.data);
        }, onError, onAbort, onProgress, onTimeout);
    };
    jsdap.loadDataset = function(url, onLoad, onError, onAbort, onProgress, onTimeout) {
        jsdap.loadDDS(url + ".dds", function(dds) {
            jsdap.loadDAS(url + ".das", dds, onLoad, onError, onAbort, onProgress, onTimeout);
        }, onError, onAbort, onProgress, onTimeout);
    };
    if (typeof module !== "undefined" && module.exports) {
        module.exports = jsdap;
    }
})();

//Define ArrayBuffer slice for IE10
if (!ArrayBuffer.prototype.slice) {
    ArrayBuffer.prototype.slice = function(begin, end) {
        if (begin === void 0) {
            begin = 0;
        }
        if (end === void 0) {
            end = this.byteLength;
        }
        begin = Math.floor(begin);
        end = Math.floor(end);
        if (begin < 0) {
            begin += this.byteLength;
        }
        if (end < 0) {
            end += this.byteLength;
        }
        begin = Math.min(Math.max(0, begin), this.byteLength);
        end = Math.min(Math.max(0, end), this.byteLength);
        if (end - begin <= 0) {
            return new ArrayBuffer(0);
        }
        var result = new ArrayBuffer(end - begin);
        var resultBytes = new Uint8Array(result);
        var sourceBytes = new Uint8Array(this, begin, end - begin);
        resultBytes.set(sourceBytes);
        return result;
    };
}