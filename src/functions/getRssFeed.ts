import { app, InvocationContext, Timer } from "@azure/functions";
import Parser from 'rss-parser';
import { AzureOpenAI, OpenAI } from "openai";
import { IncomingWebhook } from "@slack/webhook";

const urlListJson = [
    {
        "category": "tech-news",
        "slackHook": "https://hooks.slack.com/services/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",
        "contents": [
            {
                "name": "Hacker News",
                "url": "https://hnrss.org/newest?points=100"
            },
        ]
    }
]

const parser = new Parser();

// RSSフィードを取得する関数
export async function getRssFeed(myTimer: Timer, context: InvocationContext): Promise<void> {
    context.log('Timer function processed request.');

    try {
        for (const urlList of urlListJson) {
            for (const content of urlList.contents) {
                // RSSフィードを取得
                const feed = await parser.parseURL(content.url);

                // feedの中身を要約してSlackに投稿
                if (feed.items) {
                    for ( const item of feed.items ) {
                        context.log(item.title);
                        context.log(item.content);
                        context.log(item.link);

                        // コンテンツを要約
                        const summary = await summarizeContent(item.content);
                        context.log(summary);
                        await postToSlack(
                            item.title,
                            content.name,
                            summary,
                            item.link,
                            urlList.slackHook
                        );
                    };
                }
            }
        }
    } catch (error) {
        console.error(error);
    }
}

// RSSフィードから得られたコンテンツを日本語で要約する関数
const summarizeContent = async (content: string): Promise<string> => {
    // 本文がない場合は空文字を返す
    if (!content) return '';

    // AOAIを使って要約する
    const apiEndpoint = process.env.AOAI_API_ENDPOINT;
    const apiKey = process.env.AOAI_API_KEY;
    const deploymentName = "gpt-4o-mini";
    const model = "GPT-4o mini";
    const apiVersion = "2024-08-01-preview";

    // 要約プロンプト
    const prompt = `## 記事要約プロンプト
あなたのタスクは与えられた記事を要約することです。記事の内容を理解し、200文字以内で箇条書きにせずに要約してください

- **主要なポイント**: 記事の重要な点を簡潔に説明。
- **結論**: 記事の結論やまとめ。
- **背景情報**: 記事が書かれた背景や文脈。
- **具体例**: 記事中の具体的な例やデータ。
- **将来の展望**: 記事の内容に基づく将来の可能性や展望。
- **教育業界への関連**: 教育分野とは関係なければ言及しなくて良い

この記事の要約では、以上の点に注意してまとめてください。

## 要約対象のテキスト
${content}

## 要約
`;

    // ここを参考に実装
    // https://learn.microsoft.com/ja-jp/azure/ai-services/openai/quickstart?tabs=command-line%2Cjavascript-keyless%2Ctypescript-key%2Cpython-new&pivots=programming-language-typescript

    // AOAIクライアントを初期化
    const openai = new AzureOpenAI ({
        endpoint: apiEndpoint,
        apiKey: apiKey,
        apiVersion: apiVersion,
        deployment: deploymentName,
    })

    // AOAI APIにリクエストを送信
    const response = await openai.chat.completions.create({
        model: "",
        messages: [
            { role: 'system', content: 'You are a news summarizer.' },
            { role: 'user', content: prompt}
        ],
    });

    // 要約結果を返す
    return response.choices[0].message.content;
}

// slackに投稿する関数
async function postToSlack(title: string, webpageName: string, summary: string, url: string, slackHook: string): Promise<void> {
    const webhookUrl = new IncomingWebhook(slackHook);

    try {
        await webhookUrl.send({
            blocks: [
                {
                    type: "header",
                    text: {
                        type: "plain_text",
                        text: title,
                        emoji: true
                    }
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: webpageName
                    }
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: summary
                    }
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `<${url}|詳細を見る>`
                    }
                },
                {
                    type: "divider"
                }
            ]
        });
        console.log("Slackにメッセージを投稿しました");
    } catch (error) {
        console.error("Slackへの投稿エラー:", error);
    }

}

// Functionを登録
app.timer('getRssFeed', {
    schedule: '0 */5 * * * *',
    handler: getRssFeed
});
