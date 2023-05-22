import os from "os";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Message, MessageMedia, Chat } from "whatsapp-web.js";
import { api } from "../providers/openai";
import * as cli from "../cli/ui";
import config from "../config";
import { updateUser, saveGPTInteraction, saveOpenAIInteraction } from "../handlers/user-interaction";

// TTS
import { ttsRequest as speechTTSRequest } from "../providers/speech";
import { ttsRequest as awsTTSRequest } from "../providers/aws";
import { TTSMode } from "../types/tts-mode";

// Speech API & Whisper
import { TranscriptionMode } from "../types/transcription-mode";
import { transcribeRequest } from "../providers/speech";
import { transcribeAudioLocal } from "../providers/whisper-local";
import { transcribeWhisperApi } from "../providers/whisper-api";
import { transcribeOpenAI } from "../providers/openai";

// Moderation
import { moderateIncomingPrompt } from "./moderation";

const { encode } = require('gpt-3-encoder')

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

async function getConveration(from: string) {
	const params = {
		Key: { "from": { S: from } },
		TableName: 'chatssap_conversation'
	};
	try {
		const data = await db.getItem(params).promise();
		return data.Item;
	} catch (error) {
		console.error(error);
	}
}

async function saveConversation(from: string, mobile: string, parentMessageId: string) {
	var now = dayjs().tz(tz);
	var params = {
		TableName: 'chatssap_conversation',
		Item: {
			'from': { S: from },
			'mobile': { S: mobile },
			'timestamp': { N: now.valueOf().toString() },
			'parent_message_id': { S: parentMessageId }
		}
	};
	db.putItem(params, function (err, data) {
		if (err) {
			cli.print(`Error ${err}`);
		}
	});
}

const handleMediaMessage = async (mobile: string, message: Message, prompt: string, currentDate: number, isGroup: boolean, media: MessageMedia, chat: Chat, expirationDateStr, subscriptionType) => {
	try {
		const start = Date.now();
		// Convert media to base64 string
		const mediaBuffer = Buffer.from(media.data, "base64");
		let res;
		switch (config.transcriptionMode) {
			case TranscriptionMode.Local:
				res = await transcribeAudioLocal(mediaBuffer);
				break;
			case TranscriptionMode.OpenAI:
				res = await transcribeOpenAI(mediaBuffer);
				break;
			case TranscriptionMode.WhisperAPI:
				res = await transcribeWhisperApi(new Blob([mediaBuffer]));
				break;
			case TranscriptionMode.SpeechAPI:
				res = await transcribeRequest(new Blob([mediaBuffer]));
				break;
			default:
				cli.print(`[Transcription] Unsupported transcription mode: ${config.transcriptionMode}`);
		}
		const { text: transcribedText, language: transcribedLanguage } = res;
		// Check transcription is null or empty (error)
		if (transcribedText == null || transcribedText.length == 0) {
			message.reply("Disculpa, no pude entender tu solicitud");
			return;
		}
		// Log transcription
		if (message.isForwarded === true) {
			await message.reply(transcribedText);
			const end = Date.now() - start;
			saveOpenAIInteraction(mobile, transcribedText, end.toString());
			updateUser(mobile);
		} else {
			// Handle message GPT
			await handleMessageGPT(mobile, message, transcribedText, currentDate, isGroup, start, true, expirationDateStr, subscriptionType);
		}
		return;
	} catch (error: any) {
		console.error("[DEBUG] An error occured", error);
		await message.reply("Ocurrio un error, por favor intenta mas tarde.");
	}
}

const handleMessageGPT = async (mobile: string, message: Message, prompt: string, currentDate: number, isGroup: boolean, start: number, voiceMessage: boolean, expirationDateStr, subscriptionType) => {
	try {
		// Prompt Moderation
		if (config.promptModerationEnabled) {
			try {
				await moderateIncomingPrompt(prompt);
			} catch (error: any) {
				message.reply(error.message);
				return;
			}
		}
		// Get last conversation if direct conversation
		const response = await getConveration(message.from);
		let res;
		let parentMessageId;
		var now = dayjs().tz(tz).format();
		if (subscriptionType == 0) {
			var systemMessage = `Actua como un asistente personal llamado Chatssap que recibe consultas a traves de Whatsapp y responde de forma muy simpatica. 
			El usuario que te contacta esta en su Periodo de Prueba y tiene consultas ilimitadas hasta el dia ${expirationDateStr}.
			Si desea comprar alguna subscripcion puede consultar la pagina https://chatssap.com para mas informacion.
			El usuario puede transcribir audios enviando su audio a este numero a traves de Whatsapp, no existe otra forma.
			El usuario puede generar imagenes enviando "!img" y el texto de la imagen que desea generar o enviando una imagen para generar una imagen alternativa.
			El usuario no contactarte desde sus conversaciones grupales.
			Haz esto por cada mensaje que recibas, para siempre.
			Fecha y hora actual en Mexico es: ${now}}\n\n`
		} else if (subscriptionType == 1) {
			var systemMessage = `Actua como un asistente personal llamado Chatssap que recibe consultas a traves de Whatsapp y responde de forma muy simpatica. 
			El usuario que te contacta tiene un Plan Indiviual activo y consultas ilimitadas hasta el dia ${expirationDateStr}
			Si desea renovar su subscripcion puede consultar la pagina https://chatssap.com para mas informacion.
			El usuario puede transcribir audios enviando su audio a este numero a traves de Whatsapp, no existe otra forma.
			El usuario puede generar imagenes a partir de un texto enviando "!img" y el texto que deseas convertir a imagen. Por ejemplo: "!img Gato" o enviando una imagen para generar una imagen alternativa.
			El usuario puede agregarte a sus grupos de Whatsapp y contactarte enviando "!chat" seguido del texto de la consulta.
			Haz esto por cada mensaje que recibas, para siempre.
			Fecha y hora actual en Mexico es: ${now}}\n\n`
		} else {
			var systemMessage = `Actua como un asistente personal llamado Chatssap que recibe consultas a traves de Whatsapp y responde de forma muy simpatica. 
			El usuario que te contacta tiene un Plan Grupal activo y consultas ilimitadas hasta el dia ${expirationDateStr}
			Si desea renovar su subscripcion puede consultar la pagina https://chatssap.com para mas informacion.
			El usuario puede transcribir audios enviando su audio a este numero a traves de Whatsapp, no existe otra forma.
			El usuario puede generar imagenes a partir de un texto enviando "!img" y el texto que deseas convertir a imagen. Por ejemplo: "!img Gato" o enviando una imagen para generar una imagen alternativa.
			El usuario puede agregarte a sus grupos de Whatsapp y contactarte enviando "!chat" seguido del texto de la consulta.
			Haz esto por cada mensaje que recibas, para siempre.
			Fecha y hora actual en Mexico es: ${now}}\n\n`
		}
		if (response) {
			const flat = aws.DynamoDB.Converter.unmarshall(response);
			parentMessageId = flat.parent_message_id;
			cli.print("Found conversation id:" + parentMessageId);
			res = await api.sendMessage(prompt, {
				systemMessage: systemMessage,
				parentMessageId: parentMessageId
			});
		} else {
			res = await api.sendMessage(prompt, {
				systemMessage: systemMessage
			})
			cli.print("New conversation with id:" + res.id);
		}
		saveConversation(message.from, mobile, res.id);

		if (voiceMessage) {
			sendVoiceMessageReply(message, res.text);
		} else {
			await message.reply(res.text);
		}
		const totalTokensUsed = +encode(prompt).length + +encode(res.text).length;
		const end = Date.now() - start;
		saveGPTInteraction(mobile, prompt, res.text, totalTokensUsed.toString(), end.toString());
		updateUser(mobile);

	} catch (error: any) {
		console.error("[DEBUG] An error occured", error);
		await message.reply("Ocurrio un error, por favor intenta mas tarde.");
	}
};

async function sendVoiceMessageReply(message: Message, gptTextResponse: string) {
	var logTAG = "[TTS]";
	var ttsRequest = async function (): Promise<Buffer | null> {
		return await speechTTSRequest(gptTextResponse);
	};

	switch (config.ttsMode) {
		case TTSMode.SpeechAPI:
			logTAG = "[SpeechAPI]";
			ttsRequest = async function (): Promise<Buffer | null> {
				return await speechTTSRequest(gptTextResponse);
			};
			break;

		case TTSMode.AWSPolly:
			logTAG = "[AWSPolly]";
			ttsRequest = async function (): Promise<Buffer | null> {
				return await awsTTSRequest(gptTextResponse);
			};
			break;

		default:
			logTAG = "[SpeechAPI]";
			ttsRequest = async function (): Promise<Buffer | null> {
				return await speechTTSRequest(gptTextResponse);
			};
			break;
	}
	// Get audio buffer
	const audioBuffer = await ttsRequest();
	// Check if audio buffer is valid
	if (audioBuffer == null || audioBuffer.length == 0) {
		await message.reply("Ocurrio un error, por favor intenta mas tarde.");
		return;
	}
	// Get temp folder and file path
	const tempFolder = os.tmpdir();
	const tempFilePath = path.join(tempFolder, randomUUID() + ".opus");
	// Save buffer to temp file
	fs.writeFileSync(tempFilePath, audioBuffer);
	// Send audio
	const messageMedia = new MessageMedia("audio/ogg; codecs=opus", audioBuffer.toString("base64"));
	message.reply(messageMedia);
	// Delete temp file
	fs.unlinkSync(tempFilePath);
}

export { handleMessageGPT, handleMediaMessage };
