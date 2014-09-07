/*
 * AuthVerifier.jsm
 * 
 * Authentication Verifier.
 *
 * Version: 1.0.0pre1 (06 September 2014)
 * 
 * Copyright (c) 2014 Philippe Lieser
 * 
 * This software is licensed under the terms of the MIT License.
 * 
 * The above copyright and license notice shall be
 * included in all copies or substantial portions of the Software.
 */

// options for JSHint
/* jshint strict:true, moz:true, smarttabs:true, unused:true */
/* global Components, Services, Task, Promise */
/* global ModuleGetter, Logging, Verifier */
/* global exceptionToStr, DKIM_InternalError */
/* exported EXPORTED_SYMBOLS, AuthVerifier */

"use strict";

const module_version = "1.0.0pre1";

var EXPORTED_SYMBOLS = [
	"AuthVerifier"
];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Task.jsm");

Cu.import("resource://dkim_verifier/ModuleGetter.jsm");
ModuleGetter.getPromise(this);

Cu.import("resource://dkim_verifier/logging.jsm");
Cu.import("resource://dkim_verifier/helper.jsm");
Cu.import("resource://dkim_verifier/dkimVerifier.jsm");

const PREF_BRANCH = "extensions.dkim_verifier.";

let log = Logging.getLogger("AuthVerifier");
let prefs = Services.prefs.getBranch(PREF_BRANCH);


var AuthVerifier = {
	get version() { return module_version; },

	/**
	 * Verifies the authentication of the msg.
	 *
	 * @param {nsIMsgDBHdr} msgHdr
	 * @param {String} [msgURI=""] Required if msg is external.
	 * @return {Promise<AuthResult>}
	 */
	verify: function _authVerifier_verify(msgHdr, msgURI) {
		var promise = Task.spawn(function () {
			// check for saved DKIM result
			let dkimResult = loadDKIMResult(msgHdr);
			if (dkimResult !== null) {
				throw new Task.Result(dkimResultToAuthResult(dkimResult));
			}

			// get msgURI if not specified
			if (!msgURI) {
				msgURI = msgHdr.folder.getUriForMsg(msgHdr);
			}

			// verify DKIM signature
			let dkimResult_defer = Promise.defer();
			Verifier.verify(msgURI, function (msgURI, result) {
				dkimResult_defer.resolve(result);
			});
			dkimResult = yield dkimResult_defer.promise;
			// save DKIM result
			saveDKIMResult(msgHdr, dkimResult);

			throw new Task.Result(dkimResultToAuthResult(dkimResult));
		});
		promise.then(null, function onReject(exception) {
			log.warn(exceptionToStr(exception));
		});
		return promise;
	},

	/**
	 * Resets the stored authentication result of the msg.
	 *
	 * @param {nsIMsgDBHdr} msgHdr
	 * @return {Promise<Undefined>}
	 */
	resetResult: function _authVerifier_resetResult(msgHdr) {
		var promise = Task.spawn(function () {
			saveDKIMResult(msgHdr, "");
		});
		promise.then(null, function onReject(exception) {
			log.warn(exceptionToStr(exception));
		});
		return promise;
	},
};

/**
 * Save DKIM result
 * 
 * @param {nsIMsgDBHdr} msgHdr
 * @param {dkimResult} dkimResult
 */
function saveDKIMResult(msgHdr, dkimResult) {
	if (prefs.getBoolPref("saveResult")) {
		// don't save result if message is external
		if (!msgHdr.folder) {
			return;
		}
		// don't save DKIM result if it's a TEMPFAIL
		if (dkimResult.result !== "TEMPFAIL") {
			return;
		}

		if (dkimResult === "") {
			log.debug("reset DKIM result");
			msgHdr.setStringProperty("dkim_verifier@pl-result", "");
		} else {
			log.debug("save DKIM result");
			msgHdr.setStringProperty("dkim_verifier@pl-result", JSON.stringify(dkimResult));
		}
	}
}

/**
 * Get saved DKIM result
 * 
 * @param {nsIMsgDBHdr} msgHdr
 * @return {dkimResult|Null} dkimResult
 */
function loadDKIMResult(msgHdr) {
	if (prefs.getBoolPref("saveResult")) {
		// don't read result if message is external
		if (!msgHdr.folder) {
			return;
		}

		let dkimResult = msgHdr.getStringProperty("dkim_verifier@pl-result");

		if (dkimResult !== "") {
			log.debug("DKIM result found: "+dkimResult);

			dkimResult = JSON.parse(dkimResult);

			if (dkimResult.version.match(/^[0-9]+/)[0] !== "1") {
				throw new DKIM_InternalError("DKIM result has wrong Version ("+dkimResult.version+")");
			}

			return dkimResult;
		}
	}

	return null;
}

/**
 * Convert dkimResult to AuthResult
 * 
 * @param {dkimResult} dkimResult
 * @return {AuthResult}
 */
function dkimResultToAuthResult(dkimResult) {
	return dkimResult;
}