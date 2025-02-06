import { app, InvocationContext, Timer } from "@azure/functions";
import Parser from 'rss-parser';
import { AzureOpenAI, OpenAI } from "openai";
import { IncomingWebhook } from "@slack/webhook";

// slackに投稿するためのWebHook URLを取得
const newsTechHook = process.env.NEWS_TECH_HOOK;
const newsLLMHook = process.env.NEWS_LLM_HOOK;
const newsMotivateHook = process.env.NEWS_MOTIVATE_HOOK;
const blogTechHook = process.env.BLOG_TECH_HOOK;

const urlListJson = [
    {
        "category": "tech-news",
        "slackHook": newsTechHook,
        "contents": [
            {
                "name": "Hacker News",
                "url": "https://hnrss.org/newest?points=100"
            },
            {
                "name": "Azure service updates",
                "url": "https://www.microsoft.com/releasecommunications/api/v2/azure/rss"
            },
            {
                "name": "The Verge",
                "url": "https://www.theverge.com/rss/index.xml"
            },
        ]
    },
    {
        "category": "news-motivate",
        "slackHook": newsMotivateHook,
        "contents": [
            {
                "name": "Konifar's ZATSU",
                "url": "http://konifar-zatsu.hatenadiary.jp/rss"
            },
        ]
    },
    {
        "category": "blog-tech",
        "slackHook": blogTechHook,
        "contents": [
            {
                "name": "GitHubブログ",
                "url": "https://blog.github.com/jp/all.atom"
            },
            {
                "name": "TECH BLOG | 株式会社AI Shift",
                "url": "https://www.ai-shift.co.jp/techblog/feed/"
            },
            {
                "name": "スタディサプリ Product Team Blog",
                "url": "http://quipper.hatenablog.com/rss"
            },
        ]
    },
    {
        "category": "news-llm",
        "slackHook": newsLLMHook,
        "contents": [
            {
                "name": "AIDB",
                "url": "https://aiboom.net/feed"
            },
            {
                "name": "Gemini",
                "url": "https://blog.google/products/gemini/rss/"
            },
            {
                "name": "Gemini Japan",
                "url": "https://note.com/google_gemini/rss"
            },
            {
                "name": "npaka note",
                "url": "https://note.com/npaka/rss"
            },
            {
                "name": "OpenAI",
                "url": "https://openai.com/news/rss.xml"
            },
            {
                "name": "Huggingface Daily Papers",
                "url": "https://rsshub.app/huggingface/daily-papers"
            },

        ]
    },
]

const parser = new Parser();

// RSSフィードを取得する関数
export async function getRssFeed(myTimer: Timer, context: InvocationContext): Promise<void> {
    context.log('Timer function processed request.');

    try {
        for (const urlList of urlListJson) {
            context.log(urlList.category);
            context.log("\n");
            context.log(urlList.slackHook);
            context.log("\n");
            for (const content of urlList.contents) {
                context.log(content.name);
                context.log("\n");
                // RSSフィードを取得
                const feed = await parser.parseURL(content.url);

                // feedの中身を要約してSlackに投稿
                if (feed.items) {
                    for ( const item of feed.items ) {
                        context.log(item.title);
                        // 12時間よりも以前の記事はスキップ
                        const date = new Date(item.pubDate);
                        const now = new Date();
                        const diff = now.getTime() - date.getTime();
                        if (diff > 43200000) {
                            context.log("12時間以上前の記事のためスキップします");
                            continue;
                        }

                        // 日本語ではない記事のみ要約する
                        const summary = shouldSummarize(item.content) 
                            ? await summarizeContent(item.content)
                            : item.content;

                        context.log(summary);
                        await postToSlack(
                            item.title,
                            item.pubDate,
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

// 要約が必要かどうか判定する関数
const shouldSummarize = (text: string): boolean => {
    // 文字数が200文字以上、または日本語でない場合は要約が必要

    // テキストが無い場合は要約は不要
    if (!text) return false;

    // 文字数が200文字以上なら要約が必要
    if (text.length > 200) return true;
    
    // 日本語文字をカウント
    const japaneseCount = Array.from(text).filter(char => {
        const code = char.charCodeAt(0);
        return (
            // ひらがな
            (code >= 0x3040 && code <= 0x309F) ||
            // カタカナ
            (code >= 0x30A0 && code <= 0x30FF) ||
            // 漢字
            (code >= 0x4E00 && code <= 0x9FFF)
        );
    }).length;
    
    // 全体の10%以上が日本語文字なら日本語とみなして要約不要
    return (japaneseCount / text.length) > 0.1;
};

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
async function postToSlack(title: string, date: string, webpageName: string, summary: string, url: string, slackHook: string): Promise<void> {
    const webhookUrl = new IncomingWebhook(slackHook);

    try {
        await webhookUrl.send({
            blocks: [
                {
                    type: "header",
                    text: {
                        type: "plain_text",
                        // titleがNullかどうかを判定して、Nullの場合は"タイトルなし"とする
                        text: Buffer.from(title).toString("utf-8") || "タイトルなし",
                        emoji: true
                    }
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `${webpageName} (${date})`
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
        console.log("completed posting to Slack");
    } catch (error) {
        console.error("Error posting to Slack: ", error);
    }

}

// Functionを登録
app.timer('getRssFeed', {
    // 毎日8:00と20:00に実行
    schedule: '0 0 8,20 * * *',
    handler: getRssFeed
});
