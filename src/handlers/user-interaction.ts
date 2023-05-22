import config from "../config";
import * as cli from "../cli/ui";
import { Actions } from "../types/actions";

// Load the AWS SDK for Node.js
var aws = require('aws-sdk');
// Set the region
var db = new aws.DynamoDB({
	apiVersion: '2012-08-10',
	region: config.awsRegion,
	accessKeyId: config.awsAccessKeyId,
	secretAccessKey: config.awsSecretAccessKey
});

// For handling dates
const dayjs = require('dayjs')
var utc = require('dayjs/plugin/utc')
// dependent on utc plugin
var timezone = require('dayjs/plugin/timezone')
var advanced = require("dayjs/plugin/advancedFormat")
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(advanced)
const tz = "America/Mexico_City"

async function updateUser(mobile: string) {
	var params = {
		Key: { "mobile": { S: mobile } },
		TableName: 'chatssap_user',
		UpdateExpression: "SET #request_count = if_not_exists(request_count, :num) + :num",
		ExpressionAttributeValues: {
			":num": { N: "1" }
		},
		ExpressionAttributeNames: { "#request_count": "request_count" },
	};
	db.updateItem(params, function (err, data) {
		if (err) {
			console.log("Error", err);
		}
	});
}


async function saveGPTInteraction(mobile: string, prompt: string, response: string, totalTokensUsed: string, time: string) {
	var now = dayjs().tz(tz);
	var params = {
		TableName: 'chatssap_interaction',
		Item: {
			'mobile': { S: mobile },
			'timestamp': { N: now.valueOf().toString() },
			'prompt': { S: prompt },
			'response': { S: response },
			'total_tokens_used': { N: totalTokensUsed },
			'action': { S: Actions.ChatGPTRequest.toString() },
			'time': { S: time }
		}
	};
	db.putItem(params, function (err, data) {
		if (err) {
			cli.print(`Error ${err}`);
		}
	});
}

async function saveDALLEInteraction(mobile: string, prompt: string, time: string) {
	var now = dayjs().tz(tz);
	var params = {
		TableName: 'chatssap_interaction',
		Item: {
			'mobile': { S: mobile },
			'timestamp': { N: now.valueOf().toString() },
			'prompt': { S: prompt },
			'action': { S: Actions.DALLERequest.toString() },
			'time': { S: time }
		}
	};
	db.putItem(params, function (err, data) {
		if (err) {
			cli.print(`Error ${err}`);
		}
	});
}

async function saveDALLEVariationInteraction(mobile: string, time: string) {
	var now = dayjs().tz(tz);
	var params = {
		TableName: 'chatssap_interaction',
		Item: {
			'mobile': { S: mobile },
			'timestamp': { N: now.valueOf().toString() },
			'action': { S: Actions.DALLEVariationRequest.toString() },
			'time': { S: time }
		}
	};
	db.putItem(params, function (err, data) {
		if (err) {
			cli.print(`Error ${err}`);
		}
	});
}

async function saveOpenAIInteraction(mobile: string, response: string, time: string) {
	var now = dayjs().tz(tz);
	var params = {
		TableName: 'chatssap_interaction',
		Item: {
			'mobile': { S: mobile },
			'timestamp': { N: now.valueOf().toString() },
			'response': { S: response },
			'action': { S: Actions.Transcription.toString() },
			'time': { S: time }
		}
	};
	db.putItem(params, function (err, data) {
		if (err) {
			cli.print(`Error ${err}`);
		}
	});
}


export { updateUser, saveGPTInteraction, saveDALLEInteraction, saveOpenAIInteraction, saveDALLEVariationInteraction };
