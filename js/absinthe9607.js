

/*jshint loopfunc:true */

Absinthe = {
	namespace: function(namespace) {

		var parts = namespace.split('.'),
			currentPart, i, length,
		// for rudimentary compatibility w/ node
		root = typeof global !== 'undefined' ? global : window,
			parent = root.Absinthe;

		for(i = 1, length = parts.length; i < length; i++) {
			currentPart = parts[i];
			parent[currentPart] = parent[currentPart] || {};
			parent = parent[currentPart];
		}
		return parent;
	}
};

Absinthe.loadBottomCalled = false;
Absinthe.appIsLoaded = false;
Absinthe.requestImages = [];

Absinthe.initialize = function(params, tasks_complete, callback) {
	Absinthe.context = (typeof module !== 'undefined' && module.exports) ? 'node' : 'web';

	if (! params) params = {};

	var config = Absinthe.config;

	// Excluded from absinthe all together.
	var browserDetect = (new Absinthe.BrowserDetect());
	if (browserDetect.browser === 'Explorer' && browserDetect.version === 6) return false;
	if (browserDetect.browser === 'Bot') return false;

	// Enforce api_key
	if (! config.api_key) {
		if(Absinthe.context !== 'node') {
			Absinthe.console.log('Absinthe Warning: No api key defined in absinthe.config.');
		}
	}

	// defaults for server and definitionServer
	if (!config.server) config.server = "absinthe.shutterstock.com";
	if (!config.definitionServer) config.definitionServer = "absinthe.picdn.net";

	Absinthe.pageURL          = Absinthe.context === 'web' ? [ window.location.origin, window.location.pathname ].join('') : params.pageURL || 'no_url';
	Absinthe.segmentations    = params.segmentations || {};
	Absinthe.segmentations.ua = Absinthe.context === 'web' ? browserDetect.toString() : Absinthe.segmentations.ua || "An unknown browser;an unknown version;an unknown OS";
	Absinthe.segmentations.pixel_ratio =  Absinthe.context === 'web' ? window.devicePixelRatio : 1;

	Absinthe.external_account_id = params.external_account_id;

	// Dynamically load experiments and metrics

	if (! tasks_complete) {
		if( !Absinthe.experiments || !Absinthe.metrics || Absinthe.util.abmode.isExplicit() ) {
			var definitionsUrl = Absinthe.util.definitionsUrl();
			var initializeContinuation = function () { Absinthe.initialize(params, true, callback); };

			Absinthe.util.loadScript(definitionsUrl, initializeContinuation);
			return;
		}
	}

	var page = new Absinthe.Page({
		experiments:         Absinthe.experiments,
		metrics:             Absinthe.metrics || [],
		cookieOverride:      params.cookieOverride,
		eligibilityParams:   params.eligibilityParams
	});
	Absinthe.page = page;

	// Create Visitor object
	if (! params.visitor_id && ! config.cookie) {
		throw "Can't continue with no cookie configuration and no explicit visitor ID assignment";
	}

	// If no id explicitly provided and if cookie is configured,  check cookie
	if (! params.visitor_id && config.cookie) {
		params.visitor_id = page.cookies().get(config.cookie.name);
	}

	Absinthe.visitor = new Absinthe.Visitor(params.visitor_id);
	// TODO: Store visit_id in shorter duration cookie
	Absinthe.visit   = new Absinthe.Visitor(params.visit_id);

	// Store visitor id in cookie if configured to do so
	if (config.cookie) {
		page.cookies().set( config.cookie.name, Absinthe.visitor.id, config.cookie.length );
	}

	page.setUp();

	Absinthe.util.forEach(page.variations, function(variation) {
		page.applyVariation(variation);
	} );

	Absinthe.util.forEach(page.metrics, function(metric) {
		page.applyMetric(metric);
	} );

	if (typeof callback === 'function' && !config.synchronousAssignments) callback();

	page.recordAssignments(function() {
		Absinthe.unitTestCallback({ initialized: true }).call();
		if (typeof callback === 'function' && config.synchronousAssignments) {
			// we need this for public/assignment get call because we set
			// experiments "cookie" when we record assignments, and we need
			// to wait for it, then send it back to the caller.
			Absinthe.page = page;
			callback();
		}
	});

	Absinthe.appIsLoaded = true;
	Absinthe.triggerOnLoadFunctions();
};

Absinthe.recordEvent = function(eventName, data) {

	data = data || {};

	var experiments = Absinthe.page.getExperiments();
	var variationIds = [];

	for (var e in experiments) {
		if (experiments.hasOwnProperty(e)) {
			variationIds.push(parseInt(experiments[e],10));
		}
	}

	var query = Absinthe.util.extend({}, data, {
		_method:     'POST',
		eventName:   eventName,
		variationId: variationIds,
		visitorId:   Absinthe.visitor.id,
		visitId:     Absinthe.visit.id,
		attr:        Absinthe.segmentations
	});

	if (Absinthe.external_account_id)
		query.externalAccountId = Absinthe.external_account_id;

	if (Absinthe.synchronousEvents)
		query.synchronous = true;

	Absinthe.request( {
		path: '/public/events',
		query: query
	} );
};

Absinthe.unitTestCallback = function(data) {
	if (typeof window === 'undefined' || ! window.callPhantom) return function () {};
	return function () { window.callPhantom(data); };
};

Absinthe.loadBottom = function () {
	if (Absinthe.loadBottomCalled) return;
	Absinthe.loadBottomCalled = true;

	Absinthe.runOnLoad( Absinthe.triggerBottom );
};

Absinthe.runAtBottom = function (fn) {
	Absinthe.util.addToFunctions('bottom', fn);
};
Absinthe.triggerBottom = function () {
	Absinthe.util.callFunctions('bottom');
};

Absinthe.runOnLoad = function (fn) {
	if (Absinthe.appIsLoaded) return fn();
	Absinthe.util.addToFunctions('onLoad', fn);
};
Absinthe.triggerOnLoadFunctions = function () {
	Absinthe.util.callFunctions('onLoad');
};

Absinthe.util = {};

Absinthe.util.queryString = {

	stringify: function(obj) {

		var params = [], j, k;

		for (k in obj) {
			if (obj.hasOwnProperty(k)) {
				if (obj[k] instanceof Array) {
					Absinthe.util.forEach(obj[k], function(v) {
						params.push( { key: k, value: v } );
					});
				} else if (obj[k] instanceof Object) {
					for (j in obj[k]) {
						if (obj[k].hasOwnProperty(j)) {
							params.push( { key: k + '[' + j + ']', value: obj[k][j] } );
						}
					}
				} else {
					params.push( { key: k, value: obj[k] } );
				}
			}
		}

		return Absinthe.util.map(params, function(p) {
			return [p.key, encodeURIComponent(p.value)].join('=');
		}).join('&');
	},

	parse: function(string) {

		if (string.length === 0) return {};
		var params = {};
		var components = string.split('&');

		Absinthe.util.forEach(components, function(component) {

			var pair = unescape(component).split('=');

			var key = pair.shift();
			var value = pair.shift();

			if (params[key] instanceof Array) {
				params[key].push(value);
			} else {
				params[key] = value;
			}
		});

		return params;
	}
};

Absinthe.util.extend = function(obj) {

	Absinthe.util.forEach(Array.prototype.slice.call(arguments, 1), function(source) {
		for (var prop in source) {
			if (source.hasOwnProperty(prop)) {
				obj[prop] = source[prop];
			}
		}
	});

	return obj;
};

Absinthe.util.definitionsUrl = function() {
	return '//' + this.definitionsUrl.host() + '/public/absinthe_data.js?' + this.queryString.stringify({
		api_key: Absinthe.config.api_key,
		mode: this.abmode()
	});
};
Absinthe.util.definitionsUrl.host = function() {
	var isAbmodeExplicit = !! Absinthe.util.abmode.isExplicit();
	return isAbmodeExplicit ? Absinthe.config.server : Absinthe.config.definitionServer;
};

Absinthe.util.abmode = function() {
	return this.abmode.isExplicit() || 'production';
};
Absinthe.util.abmode.isExplicit = function() {
	return this.fromQuerystring() || this.fromCookie();
};
Absinthe.util.abmode.fromQuerystring = function() {
	var querystring = window.location.search.replace(/^\?/,'');
	if (Absinthe.context === 'web') return Absinthe.util.queryString.parse(querystring).abmode;
};
Absinthe.util.abmode.fromCookie = function() {
	if (Absinthe.context === 'web') return Absinthe.Page.prototype.cookies().get('abmode');
};

// Taken from http://www.jquery4u.com/javascript/dynamically-load-jquery-library-javascript/
Absinthe.util._loadedScripts = {};
Absinthe.util.loadScript = function(url, callback) {
	if (Absinthe.util._loadedScripts[url]) return callback();

	if (Absinthe.context === 'node') {
		var request = require('request');
		var protocol=/^http/i;
		var fullURL = protocol.test(url) ? url : 'http:' + url;

		request(fullURL, function (error, response, body) {
			if (!error && response.statusCode === 200) {
				try {
					eval(body);
				} catch(ex) {
					try {
						Absinthe.console.log('Error when trying to evaluate javascript: ' + ex);
					} catch(e) {}
				}
				callback();
			}
		});
	} else {
		var script = document.createElement("script");
		script.type = "text/javascript";
		script.src = url;
		document.getElementsByTagName("head")[0].appendChild(script);

		if (script.readyState) { //IE
			script.onreadystatechange = function () {
				if (script.readyState === "loaded" || script.readyState === "complete") {
					script.onreadystatechange = null;
					callback();
					Absinthe.util._loadedScripts[url] = 1;
				}
			};
		} else { //Others
			script.onload = function () {
				callback();
				Absinthe.util._loadedScripts[url] = 1;
			};
		}
	}
};

/*
 * createStyleFromText(css)
 *
 * Returns an unplaced <style> node given text
 */
Absinthe.util.createStyleFromText = function (cssText) {
	var style = document.createElement('style'),
		rules = document.createTextNode(cssText);

	style.type = 'text/css';

	if (style.styleSheet) {
		style.styleSheet.cssText = rules.nodeValue;
	} else {
		style.appendChild(rules);
	}

	return style;
};

/*
 * matchURL(regex)
 *
 * Given a string or a RegExp object, return bool wether the current location matches
 *
 * Given the location:
 *   http://www.google.com/q?id=39239#alink
 *
 * Matches against:
 *   http://www.google.com/q
 */
Absinthe.util.matchURL = function (regex) {
	if (typeof regex === 'string' || ! regex instanceof RegExp) {
		regex = new RegExp(regex);
	}
	return regex.test(Absinthe.pageURL);
};

Absinthe.util.evalJS = function(jsText) {
	'use strict';
	var fn;
	try {
		eval('fn = function(params) {' + jsText + '};');
	} catch(ex) {
		try {
			Absinthe.console.log('Absinthe: Failed to evalJS: ' + ex);
		} catch(e) {}
		fn = function() { };
	}
	return fn;
};

/* array helpers */

Absinthe.util.forEach = function(list, fn, scope) {
	for (var i= 0, n= list.length; i<n; i++)
	if (i in list)
		fn.call(scope, list[i], i, list);
};

Absinthe.util.filter = function(list, fn) {
	if (list === null)
		throw new TypeError();

	var t = Object(list);
	var len = t.length >>> 0;
	if (typeof fn !== "function")
		throw new TypeError();

	var res = [];
	var listp = arguments[1];
	for (var i = 0; i < len; i++) {
		if (i in t) {
			var val = t[i]; // in case fn mutates list
			if (fn.call(listp, val, i, t))
				res.push(val);
		}
	}

	return res;
};

Absinthe.util.map = function(list, callback, thisArg) {
	var T, A, k;

	if (list === null) {
		throw new TypeError(" this is null or not defined");
	}

	var O = Object(list);

	var len = O.length >>> 0;

	if (typeof callback !== "function") {
		throw new TypeError(callback + " is not a function");
	}

	if (thisArg) {
		T = thisArg;
	}

	A = new Array(len);

	k = 0;

	while(k < len) {
		var kValue, mappedValue;

		if (k in O) {

			kValue = O[ k ];

			mappedValue = callback.call(T, kValue, k, O);

			A[ k ] = mappedValue;
		}
		k++;
	}

	return A;
};

Absinthe.util.addToFunctions = function (name, fn) {
	if (fn === undefined || typeof fn !== 'function') return;
	var key = "_" + name + "_functions";
	if (Absinthe[key] === undefined) Absinthe[key] = [];
	Absinthe[key].push(fn);
};

Absinthe.util.callFunctions = function (name) {
	var key = "_" + name + "_functions";
	var funcs = Absinthe[key];
	if (! funcs) return;
	Absinthe.util.forEach(funcs, function (fn) { fn(); });
};

Absinthe.util.base64 = {
	/**
	 *  Base64 encode / decode
	 *  http://www.webtoolkit.info/
	 **/
	_keyStr : 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=',

	encode : function (input) {
		var output = "";
		var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
		var i = 0;

		while (i < input.length) {

			chr1 = input.charCodeAt(i++);
			chr2 = input.charCodeAt(i++);
			chr3 = input.charCodeAt(i++);

			enc1 = chr1 >> 2;
			enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
			enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
			enc4 = chr3 & 63;

			if (isNaN(chr2)) {
				enc3 = enc4 = 64;
			} else if (isNaN(chr3)) {
				enc4 = 64;
			}

			output = output +
				this._keyStr.charAt(enc1) + this._keyStr.charAt(enc2) +
				this._keyStr.charAt(enc3) + this._keyStr.charAt(enc4);

		}

		return output;
	},

	// public method for decoding
	decode : function (input) {
		var output = "";
		var chr1, chr2, chr3;
		var enc1, enc2, enc3, enc4;
		var i = 0;

		input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");

		while (i < input.length) {

			enc1 = this._keyStr.indexOf(input.charAt(i++));
			enc2 = this._keyStr.indexOf(input.charAt(i++));
			enc3 = this._keyStr.indexOf(input.charAt(i++));
			enc4 = this._keyStr.indexOf(input.charAt(i++));

			chr1 = (enc1 << 2) | (enc2 >> 4);
			chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
			chr3 = ((enc3 & 3) << 6) | enc4;

			output = output + String.fromCharCode(chr1);

			if (enc3 !== 64) {
				output = output + String.fromCharCode(chr2);
			}
			if (enc4 !== 64) {
				output = output + String.fromCharCode(chr3);
			}

		}

		return output;
	}
};

Absinthe.request = function(options) {
	var server = options.server || Absinthe.config.server;
	var path = options.path;

	var query = options.query;
	query.rand = Math.floor(Math.random() * 10000000);
	query.api_key = Absinthe.config.api_key;

	var querystring = Absinthe.util.queryString.stringify(query);

	var createCORSRequest = function(method,url) {
		var xhr = null;

		try {
			xhr = new XMLHttpRequest();
			if ("withCredentials" in xhr){
				xhr.open(method, url, true);
			} else if (typeof XDomainRequest !== "undefined"){
				xhr = new XDomainRequest();
				xhr.open(method, url);
			} else {
				xhr = null;
			}
		} catch(e) {}

		return xhr;
	};

	var img_request = function(url, cb) {
		var img = new Image();
		if (cb) img.onload = cb;
		img.src = url;
		Absinthe.requestImages.push(img);
	};

	var url;

	if (Absinthe.context === 'web') {
		url = [document.location.protocol + '//' + server + path, querystring].join('?');

		var xhr = createCORSRequest('GET', url);

		if (xhr) {
			xhr.onload = function() {
				if (options.callback)
					options.callback();
			};
			xhr.onerror = function() {
				img_request(url, options.callback);
			};
			xhr.send();
		} else {
			img_request(url, options.callback);
		}

	} else if (Absinthe.context === 'node') {
		var request = require('request');
		url = ['http://' + server + path, querystring].join('?');
		request.get(url, function(error) {
			if (!error && typeof options.callback === 'function')
				options.callback();
		});
	} else {
		throw new Error("Absinthe.context of '" + Absinthe.context + "' is not supported.");
	}

};

Absinthe.console = (function (global, inNode) {
	// nullobject console api (at least the methods we use in Absinthe)
	var nullConsole = (function (noop) {
		return {
			log: noop,
			error: noop,
			info: noop,
			warn: noop
		};
	})( function(){} );

	// the built-in console if it exists; nullConsole otherwise
	var builtinConsole = global.console || nullConsole;

	// return builtin console if in node or ?abconsole=1
	var useBuiltin = inNode || global.location.search.match(/\babconsole=1\b/);

	return useBuiltin ? builtinConsole : nullConsole;
})(this, typeof module !== 'undefined' && module.exports);

// support for loading in node
if (typeof module !== 'undefined' && module.exports) {
	module.exports = Absinthe;
}
/* Adapted from https://github.com/Jakobo/PTClass */

/*
Copyright (c) 2005-2010 Sam Stephenson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
/* Based on Alex Arnell's inheritance implementation. */
/** section: Language
 * class Class
 *
 *  Manages Prototype's class-based OOP system.
 *
 *  Refer to Prototype's web site for a [tutorial on classes and
 *  inheritance](http://prototypejs.org/learn/class-inheritance).
**/
(function(globalContext) {
/* ------------------------------------ */
/* Import from object.js                */
/* ------------------------------------ */
var _toString = Object.prototype.toString,
    NULL_TYPE = 'Null',
    UNDEFINED_TYPE = 'Undefined',
    BOOLEAN_TYPE = 'Boolean',
    NUMBER_TYPE = 'Number',
    STRING_TYPE = 'String',
    OBJECT_TYPE = 'Object',
    FUNCTION_CLASS = '[object Function]';
function isFunction(object) {
  return _toString.call(object) === FUNCTION_CLASS;
}
function extend(destination, source) {
  for (var property in source) if (source.hasOwnProperty(property)) // modify protect primitive slaughter
    destination[property] = source[property];
  return destination;
}
function keys(object) {
  if (Type(object) !== OBJECT_TYPE) { throw new TypeError(); }
  var results = [];
  for (var property in object) {
    if (object.hasOwnProperty(property)) {
      results.push(property);
    }
  }
  return results;
}
function Type(o) {
  switch(o) {
    case null: return NULL_TYPE;
    case (void 0): return UNDEFINED_TYPE;
  }
  var type = typeof o;
  switch(type) {
    case 'boolean': return BOOLEAN_TYPE;
    case 'number':  return NUMBER_TYPE;
    case 'string':  return STRING_TYPE;
  }
  return OBJECT_TYPE;
}
function isUndefined(object) {
  return typeof object === "undefined";
}
/* ------------------------------------ */
/* Import from Function.js              */
/* ------------------------------------ */
var slice = Array.prototype.slice;
function argumentNames(fn) {
  var names = fn.toString().match(/^[\s\(]*function[^(]*\(([^)]*)\)/)[1]
    .replace(/\/\/.*?[\r\n]|\/\*(?:.|[\r\n])*?\*\//g, '')
    .replace(/\s+/g, '').split(',');
  return names.length == 1 && !names[0] ? [] : names;
}
function wrap(fn, wrapper) {
  var __method = fn;
  return function() {
    var a = update([bind(__method, this)], arguments);
    return wrapper.apply(this, a);
  };
}
function update(array, args) {
  var arrayLength = array.length, length = args.length;
  while (length--) array[arrayLength + length] = args[length];
  return array;
}
function merge(array, args) {
  array = slice.call(array, 0);
  return update(array, args);
}
function bind(fn, context) {
  if (arguments.length < 2 && isUndefined(arguments[0])) return this;
  var __method = fn, args = slice.call(arguments, 2);
  return function() {
    var a = merge(args, arguments);
    return __method.apply(context, a);
  };
}

/* ------------------------------------ */
/* Import from Prototype.js             */
/* ------------------------------------ */
var emptyFunction = function(){};

var Class = (function() {
  
  // Some versions of JScript fail to enumerate over properties, names of which 
  // correspond to non-enumerable properties in the prototype chain
  var IS_DONTENUM_BUGGY = (function(){
    for (var p in { toString: 1 }) {
      // check actual property name, so that it works with augmented Object.prototype
      if (p === 'toString') return false;
    }
    return true;
  })();
  
  function subclass() {}
  function create() {
    var parent = null, properties = [].slice.apply(arguments);
    if (isFunction(properties[0]))
      parent = properties.shift();

    function klass() {
      this.initialize.apply(this, arguments);
    }

    extend(klass, Class.Methods);
    klass.superclass = parent;
    klass.subclasses = [];

    if (parent) {
      subclass.prototype = parent.prototype;
      klass.prototype = new subclass;
      try { parent.subclasses.push(klass); } catch(e) {}
    }

    for (var i = 0, length = properties.length; i < length; i++)
      klass.addMethods(properties[i]);

    if (!klass.prototype.initialize)
      klass.prototype.initialize = emptyFunction;

    klass.prototype.constructor = klass;
    return klass;
  }

  function addMethods(source) {
    var ancestor   = this.superclass && this.superclass.prototype,
        properties = keys(source);

    // IE6 doesn't enumerate `toString` and `valueOf` (among other built-in `Object.prototype`) properties,
    // Force copy if they're not Object.prototype ones.
    // Do not copy other Object.prototype.* for performance reasons
    if (IS_DONTENUM_BUGGY) {
      if (source.toString != Object.prototype.toString)
        properties.push("toString");
      if (source.valueOf != Object.prototype.valueOf)
        properties.push("valueOf");
    }

    for (var i = 0, length = properties.length; i < length; i++) {
      var property = properties[i], value = source[property];
      if (ancestor && isFunction(value) &&
          argumentNames(value)[0] == "$super") {
        var method = value;
        value = wrap((function(m) {
          return function() { return ancestor[m].apply(this, arguments); };
        })(property), method);

        value.valueOf = bind(method.valueOf, method);
        value.toString = bind(method.toString, method);
      }
      this.prototype[property] = value;
    }

    return this;
  }

  return {
    create: create,
    Methods: {
      addMethods: addMethods
    }
  };
})();

if (globalContext.exports) {
  globalContext.exports.Class = Class;
}
else {
  globalContext.Class = Class;
}
})(Absinthe);
Absinthe.namespace('Absinthe.Experiment');

Absinthe.Experiment = Absinthe.Class.create( {

	initialize: function(options) {

		this.id = options._id;
		this.variations = options.variations;
		this.isActive = options.isActive !== undefined ? options.isActive : true;
		this.eligibilityURLRegex = new RegExp(options.eligibilityURLRegex);
		this.eligibilityTest = options.eligibilityTest ? Absinthe.util.evalJS(options.eligibilityTest) : function() { return true; };
		this.eligibilityPercent = options.eligibilityPercent;
		this.assignmentType = options.assignmentType;
	},

	isVisitorEligible: function (params) {
		try{
			if (! this.eligibilityTest(params)) { return false; }
		}catch(ex){
			return false;
		}
		return true;
	},

	assign: function() {

		// Filter out visitors by experiment eligibility percent
		if (this.eligilibityPercent !== 100 && (this.eligibilityPercent / 100) < this.srandFraction(1337)) return;

		var runningIndex = 0;
		var variation;
		var targetFraction = this.srandFraction(1000);
		var newTargetFraction = this.srandFraction(10000000000);
		var fraction;

		Absinthe.util.forEach(this.variations, function(v) {

			if (variation) return;

			// use new granular fraction for variations created after 12/16/13, remove once legacy experiments are expired.
			fraction = v._id > 10432 ? newTargetFraction : targetFraction;

			if ( fraction < runningIndex + v.weight ) {
				variation = v;
			}

			runningIndex += v.weight;
		} );

		return variation;
	},

	// Get a seeded random integer from 0 to (size - 1)
	srand: function (size) {
		var assignment_determinator = Absinthe.visitor.id;
		if (this.assignmentType === 'external_account_id' && Absinthe.external_account_id !== undefined && Absinthe.external_account_id !== null) {
			assignment_determinator = Absinthe.external_account_id;
		}

		if (! this.md5int)
			this.md5int = parseInt(Absinthe.md5([this.id, assignment_determinator].join(';')), 16);
		return this.md5int % size;
	},

	// Return a seeded random fraction.  Provide a different value for size to get a different deterministic value.
	srandFraction: function (size) {
		return (this.srand(size) + 1) / size;
	}

} );

Absinthe.namespace('Absinthe.Visitor');

Absinthe.Visitor = Absinthe.Class.create( {

	initialize: function(id) {
		this.id = id || this.generateId();
	},

	generateId: function() {
		return Math.floor(Math.random() * (Math.pow(2, 32) - 1));
	}

} );

Absinthe.Page = Absinthe.Class.create( {

	initialize: function(options) {
		this.variations = options.variations || [];
		this.experiments = options.experiments || [];
		this.visit_variations = [];
		this.metrics = options.metrics || [];
		this.eligibilityParams = options.eligibilityParams;
		this._cookieOverrideJar = {};

		if (typeof options.cookieOverride !== 'undefined') {
			// lets populate our cookie object
			for (var c in options.cookieOverride) {
				if (options.cookieOverride.hasOwnProperty(c)) {
					this._cookieOverrideJar[c] = { value: options.cookieOverride[c] };
				}
			}
		}
	},

	setUp: function() {
		var query = this.query();
		var variationOverrides = {};
		var abv = query.abv || this.cookies().get('abv');

		// let's get our visit_exp cookie

		if (abv) {
			var components = abv.split(/-/);

			var experiment_id = components.shift();
			var variation_id = components.shift();

			var check = components.shift();

			if (experiment_id && variation_id && check) {

				var salt = 'wormwood';
				var hash = Absinthe.md5([experiment_id, variation_id, salt].join(';'));

				if (hash === check) {
					variationOverrides[experiment_id] = +variation_id;
				}
			}
		}

		var visit_experiments = this.getVisitExperiments();

		Absinthe.util.forEach(this.experiments, function(e) {

			var experiment = new Absinthe.Experiment(e),
				variation, overrideVariationId;

			if (! experiment.isActive) return;
			if (! Absinthe.util.matchURL(experiment.eligibilityURLRegex)) return;
			if (! experiment.isVisitorEligible(this.eligibilityParams)) return;

			overrideVariationId = variationOverrides[e._id];

			if (overrideVariationId) {
				variation = Absinthe.util
				.filter(experiment.variations, function(v) { return v._id === overrideVariationId; })
				.shift();

			} else {
				variation = experiment.assign();
			}

			if (variation) {
				this.variations.push(variation);
				if (!visit_experiments[experiment.id]) {
					visit_experiments[experiment.id] = variation._id;
					this.visit_variations.push(variation._id);
				}
			}
		}, this );

		this.setVisitExperiments(visit_experiments);
	},

	applyVariation: function(variation) {
		// noting to apply on non web pages
		if (Absinthe.context !== 'web') return;

		Absinthe.lastAppliedVariation = variation;

		this._injectCSS(variation.css);
		this._injectJS(variation.js_domready);
		this._executeJS(variation.js_head);
	},

	applyMetric: function(metric) {
		if (metric.url_match_regex && ! Absinthe.util.matchURL(metric.url_match_regex)) return;
		if (!metric.javascript) return;

		if (Absinthe.context === 'web') {
			// web we inject it so it fires on dom ready
			this._injectJS(metric.javascript);
		} else if (Absinthe.context === 'node') {
			// node context lets excute the javascript right away
			this._executeJS(metric.javascript);
		}
	},

	_injectCSS: function(cssText) {
		if (!cssText) return;

		var head  = document.getElementsByTagName('head')[0],
			style = Absinthe.util.createStyleFromText(cssText);

		head.appendChild(style);
	},

	_injectJS: function(jsText) {

		if (! jsText) return;
		this._domReady(Absinthe.util.evalJS(jsText));
	},

	_executeJS: function(jsText) {

		if (! jsText) return;

		try {
			Absinthe.util.evalJS(jsText).call();
		} catch (ex) {
			try {
				Absinthe.console.info("Absinthe: variation JS failed to execute: " + ex);
			} catch(e) {}
			return;
		}
	},

	_domReady: function(fn) {

		var win  = window,
			doc  = win.document,
			done = false,
			top  = true,
			root = doc.documentElement,
			add  = doc.addEventListener ? 'addEventListener'    : 'attachEvent',
			rem  = doc.addEventListener ? 'removeEventListener' : 'detachEvent',
			pre  = doc.addEventListener ? '' : 'on';

		if (typeof fn !== 'function') throw "You must pass a function to _domReady";

		var init = function(e) {

			// e is either an event object or the text 'lazy'
			var event_type = typeof e === 'string' ? e : e.type;

			if (typeof e !== 'string') {
				// The readystatechange event doesn't always mean the DOM is complete
				if (e.type === 'readystatechange' && doc.readyState !== 'complete') {
					return;
				}

				// Remove the event listener that brought us here; we only need to be called once
				(e.type === 'load' ? win : doc)[rem](pre + e.type, init, false);
			}

			// Don't call again
			if (done) return;
			done = true;

			// Call the variation JS
			try {
				fn.call(win, event_type);
			}
			catch (ex) {
				try {
					Absinthe.console.info("Absinthe variation failed to apply: " + ex);
				} catch(e) {}
			}
		};

		Absinthe.runAtBottom(function () {
			if (done) return;
			done = true;
			try {
				fn();
			}
			catch (ex) {
				try {
					Absinthe.console.info("Absinthe variation failed to apply: " + ex);
				} catch(e) {}
			}
		});

		var poll = function() {
			try { root.doScroll('left'); } catch(e) { window.setTimeout(poll, 50); return; }
			init('poll');
		};

		if (doc.readyState === 'complete') {
			if (!done) {
				done = true;
				try {
					fn.call(win, 'lazy');
				} catch (ex) {
					try {
						Absinthe.console.info("Absinthe variation failed to apply: " + ex);
					} catch(e) {}
				}
			}
		} else {
			if (doc.createEventObject && root.doScroll) {
				try { top = !win.frameElement; } catch(e) { }
				if (top) poll();
			}

			doc[add](pre + 'DOMContentLoaded', init, false);
			doc[add](pre + 'readystatechange', init, false);
			win[add](pre + 'load', init, false);
		}
	},

	getVisitExperiments: function() {
		var experiments             = {};
		var visit_experiment_cookie = this.cookies().get('visit_exp');

		if (!visit_experiment_cookie) {
			// didn't find anything so lets return an empty {}
			return experiments;
		}

		visit_experiment_cookie = Absinthe.util.base64.decode(visit_experiment_cookie);

		var visit_id = Absinthe.visit.id;
		var visit_cookie_split = visit_experiment_cookie.split('/');
		var visit_cookie_visit_id = visit_cookie_split[0];

		if (parseInt(visit_id,10) !== parseInt(visit_cookie_visit_id,10)) {
			return experiments;
		}

		var cookie_experiments_list = visit_cookie_split[1].split(',');

		Absinthe.util.forEach(cookie_experiments_list, function(v) {
			var experiment_variation = v.split(':');
			experiments[experiment_variation[0]] = experiment_variation[1];
		});

		return experiments;
	},
	setOverride: function(override_data) {
		this.cookies().set('abv', override_data);
	},
	setVisitExperiments: function(experiments) {
		var experiment_variations = [];
		var visit_id = Absinthe.visit.id;

		for (var exp_key in experiments) {
			if (experiments.hasOwnProperty(exp_key)) {
				experiment_variations.push([exp_key, experiments[exp_key]].join(':'));
			}
		}

		var visit_cookie_value = Absinthe.util.base64.encode(visit_id + '/' + experiment_variations.join(','));

		// 24 hour cookie being set.  If someone has a visit id persisting for over 48 hours
		// we've got bigger problems elsewhere...
		this.cookies().set('visit_exp', visit_cookie_value, 60 * 60 * 48);
	},

	getExperiments: function() {
		var experiments_cookie = this.cookies().get('exp'),
			old_experiments_cookie = this.cookies().get('experiments'),
			experiments = {},
			set_experiments = false;

		if (old_experiments_cookie && !experiments_cookie) {
			// removes all experiments from 'experiments' cookie, sets them into to 'exp' cookie (later down the line)
			experiments_cookie = old_experiments_cookie;
			// delete old experiments cookie
			this.cookies().set('experiments', '', -1, true);
			set_experiments = true;
		}

		if(experiments_cookie){

			var comma_seperated_experiments;

			if (/^v2\//.test(experiments_cookie)) {
				// currently only v2/ prepended values for 'experiments'
				comma_seperated_experiments = Absinthe.util.base64.decode(experiments_cookie.substr(3)); // first 3 chars are /v2
			} else {
				// we want to base64 encode as well as encodeURIComponent (we used to store unencoded).
				// so if it's not v2, lets reset the cookie real quick.
				comma_seperated_experiments = experiments_cookie;
				set_experiments = true;
			}
			var experiment_list = comma_seperated_experiments.split(',');
			Absinthe.util.forEach( experiment_list, function ( v ) {
				var experiment_variation = v.split(':');
				experiments[experiment_variation[0]] = experiment_variation[1];
			} );
		}

		if (set_experiments) {
			// cool eventually all our cookies should be /v2 meaning
			// base64 encoded.
			this.setExperiments(experiments);
		}

		return experiments;
	},

	setExperiments: function(experiments) {
		var experiment_variations = [];

		for (var exp_key in experiments) {
			if (experiments.hasOwnProperty(exp_key)) {
				experiment_variations.push([exp_key, experiments[exp_key]].join(':'));
			}
		}

		var ten_years    = 315360000;

		var cookie_value = 'v2/' + Absinthe.util.base64.encode(experiment_variations.join(','));

		this.cookies().set('exp', cookie_value, ten_years);
	},

	recordAssignments: function(callback) {

		var experiments = this.getExperiments();

		// Delete any experiments from the cookie that are no longer present in Absinthe.experiments (may have been disabled)
		var current_experiment_ids = {}, deleted_keys = false;
		Absinthe.util.forEach(Absinthe.experiments, function (e) { current_experiment_ids[ e._id ] = true });
		for (var exp_key in experiments) {
			if (experiments.hasOwnProperty(exp_key)) {
				if (! current_experiment_ids[ exp_key ]) {
					deleted_keys = true;
					delete experiments[ exp_key ];
				}
			}
		}
		if (deleted_keys) this.setExperiments(experiments);

		var newlyAssignedVariations = Absinthe.util.filter(this.variations, function(v) {
			if (!experiments[ v.experimentId ]) return true;
			if (parseInt(experiments[ v.experimentId ], 10) !== parseInt(v._id, 10)) return true;
		}),
		variationIds = Absinthe.util.map(newlyAssignedVariations, function(v) { return v._id; });

		// this callback is for testing purposes so we know when to run our tests.  we don't test
		// visit variations really so we don't have to fire a callback for it.
		var fire_callback = true;

		if (variationIds.length) {
			var query = {
				_method:     'POST',
				variationId: variationIds,
				visitorId:   Absinthe.visitor.id,
				visitId:     Absinthe.visit.id,
				attr:        Absinthe.segmentations
			};

			if (Absinthe.external_account_id)
				query.externalAccountId = Absinthe.external_account_id;

			if (Absinthe.config.synchronousAssignments) {
				query.synchronous = 1;
			}

			fire_callback = false;

			Absinthe.request( {
				path: '/public/assignments',
				query: query,
				callback: callback
			} );

			// Refetch the experiments, update the object and store (avoid race)

			experiments = this.getExperiments();

			Absinthe.util.forEach(newlyAssignedVariations, function(v) {
				experiments[v.experimentId] = v._id;
			} );

			this.setExperiments(experiments);
		}

		if (this.visit_variations.length) {
			var visit_variations_query = {
				_method: 'POST',
				variationId: this.visit_variations,
				visitorId: Absinthe.visitor.id,
				visitId: Absinthe.visit.id
			};
			if (Absinthe.external_account_id)
				visit_variations_query.externalAccountId = Absinthe.external_account_id;

			// Lastly let's record visit assignments
			Absinthe.request({
				path: '/public/visits',
				query: visit_variations_query
			});
		}

		if (fire_callback) {
			callback();
		}
	},

	cookies: function() {
		// coovieOverride is used when this is being called by nodejs via a public route
		// since it doesn't have the notion of cookies, it will receive cookies from the caller
		// and it will send back what cookies it should set/delete.
		if (Absinthe.config.cookieOverride) {
			return this._cookieOverride(this);
		}

		return this._cookieHttp;
	},

	_cookieHttp: {

		set: function(name,value,seconds,no_domain) {
			var expires = '',
				domain = '',
				date = new Date();

			// defaults to false, this is mostly an option because we want to clear
			// old experiments cookie which was set with no domain.
			no_domain = typeof no_domain !== 'undefined' ? no_domain : false;

			if (seconds) {
				date.setTime(date.getTime() + (seconds*1000));
				expires = ';expires=' + date.toGMTString();
			}
			// added cookie name prefix to prevent subdomain shadowing
			if(Absinthe.config.api_key && Absinthe.config.api_key.length >= 7) {
				name = Absinthe.config.api_key.substr(1,7) + name;
			}

			if (!no_domain && typeof Absinthe.config !== 'undefined' && Absinthe.config.cookieDomain) {
				domain = ';domain=' + Absinthe.config.cookieDomain;
			}

			document.cookie = name + '=' + encodeURIComponent(value) + expires + ';path=/' + domain;
		},

		get: function(name) {
			if(Absinthe.config.api_key && Absinthe.config.api_key.length >= 7) {
				name = Absinthe.config.api_key.substr(1,7) + name;
			}
			var nameEQ = name + "=";
			var ca = document.cookie.split(';');
			for(var i=0;i < ca.length;i++) {
				var c = ca[i];
				while (c.charAt(0) === ' ') c = c.substring(1,c.length);
				if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length,c.length));
			}
			return null;
		},

		erase: function() {
			throw "Not implemented";
		}
	},

	_cookieOverride: function(this_page) {
		return {
			set: function(name,value,seconds,no_domain) {
				var domain = '';
				// defaults to false, this is mostly an option because we want to clear
				// old experiments cookie which was set with no domain.
				no_domain = typeof no_domain !== 'undefined' ? no_domain : false;
				if (!no_domain && typeof Absinthe.config !== 'undefined' && Absinthe.config.cookieDomain) {
					domain = Absinthe.config.cookieDomain;
				}

				this_page._cookieOverrideJar[name] = {
					"value": value,
					"action": "set",
					"seconds": seconds,
					"domain": domain
				};
			},
			get: function(name) {
				return typeof this_page._cookieOverrideJar[name] !== 'undefined' ? this_page._cookieOverrideJar[name].value : null;
			},
			erase: function(name) {
				if (typeof this_page._cookieOverrideJar[name] !== 'undefined') {
					this_page._cookieOverrideJar[name].action  = 'erase';
					this_page._cookieOverrideJar[name].seconds = -1;
				}
			}
		};
	},

	query: function() {
		var query_string = (Absinthe.context === 'web') ? document.location.search.substring(1) : '';
		var query = Absinthe.util.queryString.parse(query_string);
		return query;
	}

} );
(function(a){function b(a,b){var c=(a&65535)+(b&65535),d=(a>>16)+(b>>16)+(c>>16);return d<<16|c&65535}function c(a,b){return a<<b|a>>>32-b}function d(a,d,e,f,g,h){return b(c(b(b(d,a),b(f,h)),g),e)}function e(a,b,c,e,f,g,h){return d(b&c|~b&e,a,b,f,g,h)}function f(a,b,c,e,f,g,h){return d(b&e|c&~e,a,b,f,g,h)}function g(a,b,c,e,f,g,h){return d(b^c^e,a,b,f,g,h)}function h(a,b,c,e,f,g,h){return d(c^(b|~e),a,b,f,g,h)}function i(a,c){a[c>>5]|=128<<c%32,a[(c+64>>>9<<4)+14]=c;var d,i,j,k,l,m=1732584193,n=-271733879,o=-1732584194,p=271733878;for(d=0;d<a.length;d+=16)i=m,j=n,k=o,l=p,m=e(m,n,o,p,a[d],7,-680876936),p=e(p,m,n,o,a[d+1],12,-389564586),o=e(o,p,m,n,a[d+2],17,606105819),n=e(n,o,p,m,a[d+3],22,-1044525330),m=e(m,n,o,p,a[d+4],7,-176418897),p=e(p,m,n,o,a[d+5],12,1200080426),o=e(o,p,m,n,a[d+6],17,-1473231341),n=e(n,o,p,m,a[d+7],22,-45705983),m=e(m,n,o,p,a[d+8],7,1770035416),p=e(p,m,n,o,a[d+9],12,-1958414417),o=e(o,p,m,n,a[d+10],17,-42063),n=e(n,o,p,m,a[d+11],22,-1990404162),m=e(m,n,o,p,a[d+12],7,1804603682),p=e(p,m,n,o,a[d+13],12,-40341101),o=e(o,p,m,n,a[d+14],17,-1502002290),n=e(n,o,p,m,a[d+15],22,1236535329),m=f(m,n,o,p,a[d+1],5,-165796510),p=f(p,m,n,o,a[d+6],9,-1069501632),o=f(o,p,m,n,a[d+11],14,643717713),n=f(n,o,p,m,a[d],20,-373897302),m=f(m,n,o,p,a[d+5],5,-701558691),p=f(p,m,n,o,a[d+10],9,38016083),o=f(o,p,m,n,a[d+15],14,-660478335),n=f(n,o,p,m,a[d+4],20,-405537848),m=f(m,n,o,p,a[d+9],5,568446438),p=f(p,m,n,o,a[d+14],9,-1019803690),o=f(o,p,m,n,a[d+3],14,-187363961),n=f(n,o,p,m,a[d+8],20,1163531501),m=f(m,n,o,p,a[d+13],5,-1444681467),p=f(p,m,n,o,a[d+2],9,-51403784),o=f(o,p,m,n,a[d+7],14,1735328473),n=f(n,o,p,m,a[d+12],20,-1926607734),m=g(m,n,o,p,a[d+5],4,-378558),p=g(p,m,n,o,a[d+8],11,-2022574463),o=g(o,p,m,n,a[d+11],16,1839030562),n=g(n,o,p,m,a[d+14],23,-35309556),m=g(m,n,o,p,a[d+1],4,-1530992060),p=g(p,m,n,o,a[d+4],11,1272893353),o=g(o,p,m,n,a[d+7],16,-155497632),n=g(n,o,p,m,a[d+10],23,-1094730640),m=g(m,n,o,p,a[d+13],4,681279174),p=g(p,m,n,o,a[d],11,-358537222),o=g(o,p,m,n,a[d+3],16,-722521979),n=g(n,o,p,m,a[d+6],23,76029189),m=g(m,n,o,p,a[d+9],4,-640364487),p=g(p,m,n,o,a[d+12],11,-421815835),o=g(o,p,m,n,a[d+15],16,530742520),n=g(n,o,p,m,a[d+2],23,-995338651),m=h(m,n,o,p,a[d],6,-198630844),p=h(p,m,n,o,a[d+7],10,1126891415),o=h(o,p,m,n,a[d+14],15,-1416354905),n=h(n,o,p,m,a[d+5],21,-57434055),m=h(m,n,o,p,a[d+12],6,1700485571),p=h(p,m,n,o,a[d+3],10,-1894986606),o=h(o,p,m,n,a[d+10],15,-1051523),n=h(n,o,p,m,a[d+1],21,-2054922799),m=h(m,n,o,p,a[d+8],6,1873313359),p=h(p,m,n,o,a[d+15],10,-30611744),o=h(o,p,m,n,a[d+6],15,-1560198380),n=h(n,o,p,m,a[d+13],21,1309151649),m=h(m,n,o,p,a[d+4],6,-145523070),p=h(p,m,n,o,a[d+11],10,-1120210379),o=h(o,p,m,n,a[d+2],15,718787259),n=h(n,o,p,m,a[d+9],21,-343485551),m=b(m,i),n=b(n,j),o=b(o,k),p=b(p,l);return[m,n,o,p]}function j(a){var b,c="";for(b=0;b<a.length*32;b+=8)c+=String.fromCharCode(a[b>>5]>>>b%32&255);return c}function k(a){var b,c=[];c[(a.length>>2)-1]=undefined;for(b=0;b<c.length;b+=1)c[b]=0;for(b=0;b<a.length*8;b+=8)c[b>>5]|=(a.charCodeAt(b/8)&255)<<b%32;return c}function l(a){return j(i(k(a),a.length*8))}function m(a,b){var c,d=k(a),e=[],f=[],g;e[15]=f[15]=undefined,d.length>16&&(d=i(d,a.length*8));for(c=0;c<16;c+=1)e[c]=d[c]^909522486,f[c]=d[c]^1549556828;return g=i(e.concat(k(b)),512+b.length*8),j(i(f.concat(g),640))}function n(a){var b="0123456789abcdef",c="",d,e;for(e=0;e<a.length;e+=1)d=a.charCodeAt(e),c+=b.charAt(d>>>4&15)+b.charAt(d&15);return c}function o(a){return unescape(encodeURIComponent(a))}function p(a){return l(o(a))}function q(a){return n(p(a))}function r(a,b){return m(o(a),o(b))}function s(a,b){return n(r(a,b))}function t(a,b,c){return b?c?r(b,a):s(b,a):c?p(a):q(a)}"use strict",typeof define=="function"&&define.amd?define(function(){return t}):a.md5=t})(Absinthe);
// Code taken from http://www.quirksmode.org/js/detect.html

Absinthe.namespace('Absinthe.BrowserDetect');

Absinthe.BrowserDetect = Absinthe.Class.create( {

	initialize: function() {

		if (typeof navigator === 'undefined') {
			this.browser = "An unknown browser";
			this.version = "an unknown version";
			this.OS      = "an unknown OS";
			return;
		}

		this.browser = this.searchString(this.dataBrowser()) || "An unknown browser";
		this.version = this.searchVersion(navigator.userAgent) || this.searchVersion(navigator.appVersion) || "an unknown version";
		this.OS = this.searchString(this.dataOS()) || "an unknown OS";
	},
	toString: function () {
		return [ this.browser, this.version, this.OS ].join(';');
	},
	searchString: function (data) {
		for (var i=0;i<data.length;i++)	{
			var dataString = data[i].string;
			var dataProp = data[i].prop;
			this.versionSearchString = data[i].versionSearch || data[i].identity;
			if (dataString) {
				if (dataString.indexOf(data[i].subString) != -1)
					return data[i].identity;
			}
			else if (dataProp)
				return data[i].identity;
		}
	},
	searchVersion: function (dataString) {
		var index = dataString.indexOf(this.versionSearchString);
		if (index == -1) return;
		return parseFloat(dataString.substring(index+this.versionSearchString.length+1));
	},
	dataBrowser: function() {
		return [
			{	// Lets grab bots
				string: navigator.userAgent.toLowerCase(),
				subString: "bot",
				identity: "Bot"
			},
			{	// Lets grab bots
				string: navigator.userAgent.toLowerCase(),
				subString: "slurp",
				identity: "Bot"
			},
			{
				string: navigator.userAgent,
				subString: "Chrome",
				identity: "Chrome"
			},
			{	string: navigator.userAgent,
				subString: "OmniWeb",
				versionSearch: "OmniWeb/",
				identity: "OmniWeb"
			},
			{
				string: navigator.vendor,
				subString: "Apple",
				identity: "Safari",
				versionSearch: "Version"
			},
			{
				prop: window.opera,
				identity: "Opera",
				versionSearch: "Version"
			},
			{
				string: navigator.vendor,
				subString: "iCab",
				identity: "iCab"
			},
			{
				string: navigator.vendor,
				subString: "KDE",
				identity: "Konqueror"
			},
			{
				string: navigator.userAgent,
				subString: "Firefox",
				identity: "Firefox"
			},
			{
				string: navigator.vendor,
				subString: "Camino",
				identity: "Camino"
			},
			{		// for newer Netscapes (6+)
				string: navigator.userAgent,
				subString: "Netscape",
				identity: "Netscape"
			},
			{
				string: navigator.userAgent,
				subString: "MSIE",
				identity: "Explorer",
				versionSearch: "MSIE"
			},
			{
				string: navigator.userAgent,
				subString: "Gecko",
				identity: "Mozilla",
				versionSearch: "rv"
			},
			{		// for older Netscapes (4-)
				string: navigator.userAgent,
				subString: "Mozilla",
				identity: "Netscape",
				versionSearch: "Mozilla"
			}
		];
	},
	dataOS: function() {
		return [
			{
				string: navigator.platform,
				subString: "Win",
				identity: "Windows"
			},
			{
				string: navigator.platform,
				subString: "Mac",
				identity: "Mac"
			},
			{
				string: navigator.userAgent,
				subString: "iPhone",
				identity: "iPhone/iPod"
			},
			{
				string: navigator.platform,
				subString: "Linux",
				identity: "Linux"
			}
		];
	}
} );



