import { Message } from "whatsapp-web.js";
import { startsWithIgnoreCase } from "../utils";

// Config & Constants
import config from "../config";

// CLI
import * as cli from "../cli/ui";

// ChatGPT & DALLE
import { handleMessageGPT } from "../handlers/gpt";
import { handleMediaMessage } from "../handlers/gpt";
import { handleMessageDALLE, handleMessageDALLEVariation } from "../handlers/dalle";

// For deciding to ignore old messages
import { botReadyTimestamp } from "../index";

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

// Load the AWS SDK for Node.js
var aws = require('aws-sdk');
// Set the region
var db = new aws.DynamoDB({
	apiVersion: '2012-08-10',
	region: config.awsRegion,
	accessKeyId: config.awsAccessKeyId,
	secretAccessKey: config.awsSecretAccessKey
});

async function getUser(mobile: string) {
	const params = {
		Key: { "mobile": { S: mobile } },
		TableName: 'chatssap_user'
	};
	try {
		const data = await db.getItem(params).promise();
		return data.Item;
	} catch (error) {
		console.error(error);
	}
}

async function saveUser(mobile: string, expirationDate: any) {
	var now = dayjs().tz(tz);
	var params = {
		TableName: 'chatssap_user',
		Item: {
			'mobile': { S: mobile },
			'timestamp': { N: now.valueOf().toString() },
			'expiration_date': { N: expirationDate.valueOf().toString() },
			'request_count': { N: "0" },
			'subscription_type': { N: "0" }
		}
	};
	db.putItem(params, function (err, data) {
		if (err) {
			cli.print(`Error ${err}`);
		}
	});
}

// Handles message
async function handleIncomingMessage(message: Message) {
	let messageString = message.body;

	// Prevent handling old messages
	if (message.timestamp != null) {
		const messageTimestamp = new Date(message.timestamp * 1000);

		// If startTimestamp is null, the bot is not ready yet
		if (botReadyTimestamp == null) {
			cli.print("[DEBUG] Ignoring message because bot is not ready yet: " + messageString);
			return;
		}

		// Ignore messages that are sent before the bot is started
		if (messageTimestamp < botReadyTimestamp) {
			cli.print("[DEBUG] Ignoring old message: " + messageString);
			return;
		}
	}

	var isGroup = (await message.getChat()).isGroup;

	// Ignore groupchats if doesn't start with prefix
	if (isGroup && (!startsWithIgnoreCase(messageString, config.gptPrefix) && !startsWithIgnoreCase(messageString, config.dallePrefix))) {
		return;
	}

	// Ignore self noted messages
	// === "5213314588477@c.us"
	if (message.fromMe || (messageString.length === 0 && !message.hasMedia)) {
		return;
	};

	const mobile = (await message.getContact()).number
	const currentDate = dayjs().tz(tz);
	var expirationDate = dayjs().tz(tz);
	var expirationDateStr;

	const res = await getUser(mobile);
	const trialLimitRequest = parseInt(config.trialLimitRequest);
	var subscriptionType = 0;

	// Get user status (!status)
	if (startsWithIgnoreCase(messageString, config.statusPrefix)) {
		if (res) {
			const flat = aws.DynamoDB.Converter.unmarshall(res);
			subscriptionType = Number(flat.subscription_type);
			const requestCount = Number(flat.request_count);
			expirationDate = Number(flat.expiration_date);
			expirationDateStr = dayjs(expirationDate).format('DD/MM/YYYY');
			if (subscriptionType == 0) {
				var remainingCount = trialLimitRequest - requestCount;
				cli.print("[DEBUG] trialLimitRequest:" + trialLimitRequest + " requestCount:" + requestCount + " remainingCount:" + remainingCount);
				if (expirationDate < currentDate || remainingCount <= 0) {
					message.reply("Se acabo tu periodo de prueba, puedes seguir usando *Chatssap* comprando una subscripcion en https://chatssap.com/");
					return;
				}
				message.reply("Puedes disfrutar de tu *Periodo de Prueba* hasta el dia " + expirationDateStr);
				return;
			}
			if (expirationDate < currentDate) {
				message.reply("Tu subscripcion ha terminado, puedes renovarla en https://chatssap.com/");
				return;
			}
			if (subscriptionType == 1) {
				message.reply("La subscripcion al *Plan Individual* de *Chatssap* estara activa hasta el dia " + expirationDateStr);
			}
			if (subscriptionType == 2) {
				message.reply("La subscripcion al *Plan Grupal* de *Chatssap* estara activa hasta el dia " + expirationDateStr);
			}
			return;
		}
		message.reply("Tu cuenta de *Chatssap* no esta activa, para comenzar tu periodo de prueba envia tu primer consulta!");
		return;
	}

	if (res) {
		const flat = aws.DynamoDB.Converter.unmarshall(res);
		subscriptionType = Number(flat.subscription_type);
		expirationDate = Number(flat.expiration_date);
		expirationDateStr = dayjs(expirationDate).format('DD/MM/YYYY');
		const requestCount = Number(flat.request_count);
		if (subscriptionType == 0) {
			var remainingCount = trialLimitRequest - requestCount;
			if (expirationDate < currentDate || remainingCount <= 0) {
				message.reply("Se acabo tu *Periodo de Prueba*, puedes seguir usando Chatssap comprando una subscripcion en https://chatssap.com/");
				return;
			}
		}
		if (expirationDate < currentDate) {
			message.reply("Tu subscripcion ha terminado, puedes renovarla en https://chatssap.com/");
			return;
		}
		if (requestCount == 0) {
			// User was created from Stripe
			await message.reply("Bienvenido a *Chatssap* puedes conocer los detalles de tu cuenta enviando la palabra *!status* a este numero, al usar el servicio aceptas nuestros terminos y condiciones que puedes consultar en https://chatssap.com/terms/");	
		}
	} else {
		expirationDate = dayjs().tz(tz).endOf('day') + 7 * 24 * 60 * 60 * 1000;
		expirationDateStr = dayjs(expirationDate).format('DD/MM/YYYY');
		saveUser(mobile, expirationDate);
		await message.reply("Bienvenido a *Chatssap*, puedes disfrutar de tu periodo de prueba hasta el dia " + expirationDateStr + ", puedes conocer los detalles de tu cuenta enviando la palabra *!status* a este numero, al usar el servicio aceptas nuestros terminos y condiciones que puedes consultar en https://chatssap.com/terms/");
	}

	if (subscriptionType == 0 && isGroup) {
		await message.reply("Usuarios en *Periodo de Prueba* no pueden interactuar con *Chatssap* en conversaciones de grupo, para actualizar tu subscripcion puedes ir a https://chatssap.com/");
		return;
	}

	if (subscriptionType == 1 && isGroup) {
		await message.reply("Usuarios en *Plan Individual* no pueden interactuar con *Chatssap* en conversaciones de grupo, para actualizar tu subscripcion puedes ir a https://chatssap.com/");
		return;
	}

	let chat = await message.getChat();

	if (message.hasMedia) {
		cli.print("[DEBUG] Message has media!");
		const media = await message.downloadMedia();
		if (!isGroup || (isGroup && (
			(startsWithIgnoreCase(messageString, config.dallePrefix) && media.mimetype.startsWith("image/")) ||
			(startsWithIgnoreCase(messageString, config.gptPrefix) && media.mimetype.startsWith("audio/"))))) {
			cli.print("Mimetype is " + media.mimetype);
			if (media.mimetype.startsWith("audio/")) {
				if (message.isForwarded === true) {
					chat.sendStateTyping();
				} else {
					chat.sendStateRecording();
				}
				const prompt = messageString.substring(config.dallePrefix.length + 1);
				await handleMediaMessage(mobile, message, prompt, currentDate, isGroup, media, chat, expirationDateStr, subscriptionType);
			}
			else if (media.mimetype.startsWith("image/")) {
				chat.sendStateTyping();
				await handleMessageDALLEVariation(message, mobile, media);
			}
		}
	} else {
		chat.sendStateTyping();
		if (startsWithIgnoreCase(messageString, config.dallePrefix)) {
			const prompt = messageString.substring(config.dallePrefix.length + 1);
			await handleMessageDALLE(message, prompt, mobile);
		}
		else if (!config.prefixEnabled && !isGroup) {
			await handleMessageGPT(mobile, message, messageString, currentDate, isGroup, Date.now(), false, expirationDateStr, subscriptionType);
		}
		else if (startsWithIgnoreCase(messageString, config.gptPrefix) && isGroup) {
			const prompt = messageString.substring(config.gptPrefix.length + 1);
			await handleMessageGPT(mobile, message, prompt, currentDate, isGroup, Date.now(), false, expirationDateStr, subscriptionType);
		}
	}
	chat.clearState();
}

export { handleIncomingMessage };
