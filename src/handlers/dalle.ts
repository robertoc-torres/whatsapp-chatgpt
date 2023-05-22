import { Message, MessageMedia } from "whatsapp-web.js";
import { openai } from "../providers/openai";
import { aiConfig } from "../handlers/ai-config";
import { CreateImageRequestSizeEnum } from "openai";
import config from "../config";
import * as cli from "../cli/ui";
import { updateUser, saveDALLEInteraction, saveDALLEVariationInteraction } from "../handlers/user-interaction";
import { randomUUID } from "crypto";

// Moderation
import { moderateIncomingPrompt } from "./moderation";

const Jimp = require("jimp");
const fs = require("fs");

const handleMessageDALLE = async (message: Message, prompt: string, mobile: string) => {
	try {
		const start = Date.now();
		cli.print(`[DALL-E] Received prompt from ${message.from}: ${prompt}`);
		// Prompt Moderation
		if (config.promptModerationEnabled) {
			try {
				await moderateIncomingPrompt(prompt);
			} catch (error: any) {
				await message.reply("Ocurrio un error, por favor intenta mas tarde.");
				return;
			}
		}
		// Send the prompt to the API
		const response = await openai.createImage({
			prompt: prompt,
			n: 1,
			size: aiConfig.dalle.size as CreateImageRequestSizeEnum,
			response_format: "b64_json"
		});

		const base64 = response.data.data[0].b64_json as string;
		const buffer64 = Buffer.from(base64, "base64");
		let logo = await Jimp.read("logo_watermark.png");
		const jpgResponseImage = await Jimp.read(buffer64);
		jpgResponseImage.composite(logo, 262, 424,
			{
				mode: Jimp.BLEND_SOURCE_OVER,
				opacityDest: 1,
				opacitySource: 0.3
			}
		);

		var finalBase64 = await jpgResponseImage.getBase64Async(Jimp.AUTO);
		finalBase64 = finalBase64.split(',')[1];

		const image = new MessageMedia("image/jpeg", finalBase64, "image.jpg");
		await message.reply(image);
		const end = Date.now() - start;
		cli.print(`[DALL-E] Answer to ${message.from} | OpenAI request took ${end}ms`);
		saveDALLEInteraction(mobile, prompt, end.toString());
		updateUser(mobile);
	} catch (error: any) {
		console.error("[DEBUG] An error occured", error);
		await message.reply("Ocurrio un error, por favor intenta mas tarde.");
	}
};


const handleMessageDALLEVariation = async (message: Message, mobile: string, media: MessageMedia) => {
	try {
		const start = Date.now();
		cli.print(`[DALL-E Variation] Received prompt from ${message.from}`);
		const imageName = randomUUID();
		const imagePath = config.imagesPath + imageName + ".png";

		const buffer = Buffer.from(media.data, "base64");
		let jpgImage = await Jimp.read(buffer);
		let logo = await Jimp.read("logo_watermark.png");

		var w = jpgImage.bitmap.width;
		var h = jpgImage.bitmap.height;
		if (w > h) { w = h }
		if (h > w) { h = w }

		jpgImage.crop(0, 0, w, h);

		cli.print(`[DALL-E Variation] Image inf w:${w}, h:${h}, imageName:${imagePath}`);
		await jpgImage.writeAsync(imagePath)

		const response = await openai.createImageVariation(
			fs.createReadStream(imagePath),
			1,
			aiConfig.dalle.size as CreateImageRequestSizeEnum,
			"b64_json"
		);

		var base64 = response.data.data[0].b64_json as string;
		const buffer64 = Buffer.from(base64, "base64");
		const jpgResponseImage = await Jimp.read(buffer64);
		jpgResponseImage.composite(logo, 262, 424,
			{
				mode: Jimp.BLEND_SOURCE_OVER,
				opacityDest: 1,
				opacitySource: 0.3
			}
		);
		var finalBase64 = await jpgResponseImage.getBase64Async(Jimp.AUTO);
		finalBase64 = finalBase64.split(',')[1];

		const image = new MessageMedia("image/jpeg", finalBase64, config.imagesPath + imageName + ".jpg");
		await message.reply(image);
		const end = Date.now() - start;
		cli.print(`[DALL-E Variation] Answer to ${message.from} | OpenAI request took ${end}ms`);

		saveDALLEVariationInteraction(mobile, end.toString());
		updateUser(mobile);

		fs.unlinkSync(imagePath);

	} catch (error: any) {
		console.error("[DEBUG] An error occured", error);
		await message.reply("Ocurrio un error, por favor intenta mas tarde.");
	}
};

export { handleMessageDALLE, handleMessageDALLEVariation };
