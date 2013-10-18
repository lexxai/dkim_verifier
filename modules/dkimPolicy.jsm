/*
 * dkimPolicy.jsm
 *
 * Verifies the DKIM-Signatures as specified in RFC 6376
 * http://tools.ietf.org/html/rfc6376
 *
 * version: 1.0.0pre3 (16 October 2013)
 *
 * Copyright (c) 2013 Philippe Lieser
 *
 * This software is licensed under the terms of the MIT License.
 *
 * The above copyright and license notice shall be
 * included in all copies or substantial portions of the Software.
 */

// options for JSHint
/* jshint moz:true */
/* jshint -W069 */ // "['{a}'] is better written in dot notation."
/* global Components, Sqlite, Task, OS, CommonUtils, Logging, exceptionToStr */
/* exported EXPORTED_SYMBOLS, dkimPolicy */

var EXPORTED_SYMBOLS = [
	"dkimPolicy"
];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Sqlite.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/osfile.jsm");
Cu.import("resource://services-common/utils.js");

Cu.import("resource://dkim_verifier/logging.jsm");
Cu.import("chrome://dkim_verifier/content/helper.js");


// rule types
const RULE_TYPE = {
	SIGNED : 1,
	NEUTRAL: 2,
};
// default rule priorities
const PRIORITY = {
	AUTOINSERT_RULE_SIGNED:  110,
	DEFAULT_RULE_SIGNED:     210,
	DEFAULT_RULE_NEUTRAL:    220,
	USERINSERT_RULE_SIGNED:  310,
	USERINSERT_RULE_NEUTRAL: 320,
};

// Promise<boolean>
var initialized;
var log = Logging.getLogger("Policy");

var dkimPolicy = {
	/**
	 * Determinates if e-mail by fromAddress should be signed
	 * 
	 * @param {String} fromAddress
	 * @param {Function} [callback] function callback(result, callbackData)
	 * @param [callbackData]
	 * 
	 * @return {Promise<Object>}
	 *         .shouldBeSigned true if fromAddress should be signed
	 *         .sdid {String} Signing Domain Identifier
	 *         .foundRule {Boolean} true if enabled rule for fromAddress was found
	 */
	shouldBeSigned: function (fromAddress, callback, callbackData) {
		"use strict";

		var promise = Task.spawn(function () {
			log.trace("shouldBeSigned Task begin");
			
			yield initialized;
			var conn = yield Sqlite.openConnection({path: "dkimPolicy.sqlite"});
			
			var sqlRes = yield conn.executeCached(
				"SELECT addr, sdid, ruletype, priority, enabled\n" +
				"FROM signers WHERE\n" +
				"  lower(:from) GLOB addr AND\n" +
				"  enabled\n" +
				"UNION SELECT addr, sdid, ruletype, priority, 1\n" +
				"FROM signersDefault WHERE\n" +
				"  lower(:from) GLOB addr\n" +
				"ORDER BY priority DESC\n" +
				"LIMIT 1;",
				{"from": fromAddress}
			);
			
			var result = {};
			if (sqlRes.length > 0) {
				if (sqlRes[0].getResultByName("ruletype") === RULE_TYPE["SIGNED"]) {
					result.shouldBeSigned = true;
					result.sdid = sqlRes[0].getResultByName("sdid");
				} else {
					result.shouldBeSigned = false;
				}
				result.foundRule = true;
			} else {
				result.shouldBeSigned = false;
				result.foundRule = false;
			}
			
			log.debug("result.shouldBeSigned: "+result.shouldBeSigned+"; result.sdid: "+result.sdid+
				"; result.foundRule: "+result.foundRule
			);
			log.trace("shouldBeSigned Task end");
			throw new Task.Result(result);
		});
		if (callback !== undefined) {
			promise.then(function onFulfill(result) {
				// result == "Resolution result for the task: Value!!!"
				// The result is undefined if no special Task.Result exception was thrown.
				if (callback) {
					callback(result, callbackData);
				}
			}).then(null, function onReject(exception) {
				// Failure!  We can inspect or report the exception.
				log.fatal(exceptionToStr(exception));
			});
		}
		return promise;
	},
	
	/**
	 * Adds should be signed rule if no enabled rule for fromAddress is found
	 * 
	 * @param {String} fromAddress
	 * @param {String} sdid
	 * 
	 * @return {Promise<Undefined>}
	 */
	signedBy: function (fromAddress, sdid) {
		"use strict";

		var promise = Task.spawn(function () {
			log.trace("signedBy Task begin");
			
			var shouldBeSignedRes = yield dkimPolicy.shouldBeSigned(fromAddress);
			if (!shouldBeSignedRes.foundRule) {
				yield addRule(fromAddress, sdid, "SIGNED", "AUTOINSERT_RULE_SIGNED");
			}
			
			log.trace("signedBy Task end");
		});
		promise.then(null, function onReject(exception) {
			// Failure!  We can inspect or report the exception.
			log.fatal(exceptionToStr(exception));
		});
		return promise;
	},
};

/**
 * Adds rule
 * 
 * @param {String} addr
 * @param {String} sdid
 * @param {String} ruletype
 * @param {String} priority
 * 
 * @return {Promise<Undefined>}
 */
function addRule(addr, sdid, ruletype, priority) {
	"use strict";

	log.trace("addRule begin");
	
	// yield initialized;
	var conn = yield Sqlite.openConnection({path: "dkimPolicy.sqlite"});
	
	log.debug("add rule (addr: "+addr+", sdid: "+sdid+
		", ruletype: "+ruletype+", priority: "+priority+
		", enabled: 1)"
	);
	yield conn.executeCached(
		"INSERT INTO signers (addr, sdid, ruletype, priority, enabled)\n" +
		"VALUES (:addr, :sdid, :ruletype, :priority, 1);",
		{
			"addr": addr,
			"sdid": sdid,
			"ruletype": RULE_TYPE[ruletype],
			"priority": PRIORITY[priority],
		}
	);

	log.trace("addRule end");
}

/**
 * init DB
 * 
 * @return {Promise<boolean>} initialized
 */
function init() {
	"use strict";

	var promise = Task.spawn(function () {
		log.trace("init Task begin");
		
		Logging.addAppenderTo("Sqlite.Connection.dkimPolicy.sqlite", "sql.");
		
		var conn = yield Sqlite.openConnection({path: "dkimPolicy.sqlite"});

		try {
			// get version numbers
			yield conn.execute(
				"CREATE TABLE IF NOT EXISTS version (\n" +
				"  name TEXT PRIMARY KEY NOT NULL,\n" +
				"  version INTEGER NOT NULL\n" +
				");"
			);
			var sqlRes = yield conn.execute(
				"SELECT * FROM version;"
			);
			var versionTableSigners = 0;
			var versionTableSignersDefault = 0;
			var versionDataSignersDefault = 0;
			sqlRes.forEach(function(element/*, index, array*/){
				switch(element.getResultByName("name")) {
					case "TableSigners":
						versionTableSigners = element.getResultByName("version");
						break;
					case "TableSignersDefault":
						versionTableSignersDefault = element.getResultByName("version");
						break;
					case "DataSignersDefault":
						versionDataSignersDefault = element.getResultByName("version");
						break;
				}
			});
			log.trace("versionTableSigners: "+versionTableSigners+
				", versionTableSignersDefault: "+versionTableSignersDefault+
				", versionDataSignersDefault: "+versionDataSignersDefault
			);

			// table signers
			if (versionTableSigners < 1) {
				log.trace("create table signers");
				// create table
				yield conn.execute(
					"CREATE TABLE IF NOT EXISTS signers (\n" +
					"  addr TEXT NOT NULL,\n" +
					"  sdid TEXT,\n" +
					"  ruletype INTEGER NOT NULL,\n" +
					"  priority INTEGER NOT NULL,\n" +
					"  enabled INTEGER NOT NULL\n" + // 0 (false) and 1 (true)
					");"
				);
				// add version number
				yield conn.execute(
					"INSERT INTO version (name, version)" +
					"VALUES ('TableSigners', 1);"
				);
				versionTableSigners = 1;
			} else if (versionTableSigners !== 1) {
					throw new Error("unsupported versionTableSigners");
			}
			
			// table signersDefault
			if (versionTableSignersDefault < 1) {
				log.trace("create table signersDefault");
				// create table
				yield conn.execute(
					"CREATE TABLE IF NOT EXISTS signersDefault (\n" +
					"  addr TEXT NOT NULL,\n" +
					"  sdid TEXT,\n" +
					"  ruletype INTEGER NOT NULL,\n" +
					"  priority INTEGER NOT NULL\n" +
					");"
				);
				// add version number
				yield conn.execute(
					"INSERT INTO version (name, version)\n" +
					"VALUES ('TableSignersDefault', 1);"
				);
				versionTableSignersDefault = 1;
			} else if (versionTableSignersDefault !== 1) {
					throw new Error("unsupported versionTableSignersDefault");
			}
			
			// data signersDefault
			// read rules from file
			var path = OS.Path.join(OS.Constants.Path.profileDir, "extensions",
				"dkim_verifier@pl",	"data", "signersDefault.json"
			);
			var signersDefault = yield CommonUtils.readJSON(path)
			// check data version
			if (versionDataSignersDefault < signersDefault.versionData) {
				log.trace("update default rules");
				if (signersDefault.versionTable !== versionTableSignersDefault) {
					throw new Error("different versionTableSignersDefault in .json file");
				}
				// delete old rules
				yield conn.execute(
					"DELETE FROM signersDefault;"
				);
				// insert new default rules
				yield conn.executeCached(
					"INSERT INTO signersDefault (addr, sdid, ruletype, priority)\n" +
					"VALUES (:addr, :sdid, :ruletype, :priority);",
					signersDefault.rules
				);
				// update version number
				yield conn.execute(
					"INSERT OR REPLACE INTO version (name, version)\n" +
					"VALUES ('DataSignersDefault', :version);",
					{"version": signersDefault.versionData}
				);
				versionTableSignersDefault = 1;
			}
		} finally {
			yield conn.close();
		}
		
		log.debug("initialized");
		log.trace("init Task end");
		throw new Task.Result(true);
	});
	promise.then(null, function onReject(exception) {
		// Failure!  We can inspect or report the exception.
		log.fatal(exceptionToStr(exception));
	});
	return promise;
}

initialized = init();