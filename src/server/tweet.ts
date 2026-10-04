/**
 * Reads a public post without X API keys: fxtwitter's public JSON first, X's syndication endpoint
 * (the one embedded tweets use) as fallback. `KUDOS_TWEET_API` points the first one at a local fake
 * in tests and on the local rig.
 */
import { ENV } from "../config/kudos.ts";

export interface Tweet {
  id: string;
  authorHandle: string;
  authorId: string | null;
  text: string;
}

export type TweetFetcher = (id: string) => Promise<Tweet | null>;

/** Status id from an x.com / twitter.com status link, or null. */
export function statusIdFromUrl(url: string): string | null {
  const m = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/(\d{5,25})/i.exec(url.trim());
  return m ? m[1] : null;
}

/** Token X's own embed script computes for the syndication endpoint. */
export function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

async function json(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export const fetchTweet: TweetFetcher = async (id) => {
  const fx = ENV.tweetApi() ?? "https://api.fxtwitter.com";
  try {
    const j = (await json(`${fx}/status/${id}`)) as { tweet?: { id?: string; text?: string; author?: { screen_name?: string; id?: string } } };
    if (j?.tweet?.author?.screen_name) {
      return { id, authorHandle: j.tweet.author.screen_name, authorId: j.tweet.author.id ? String(j.tweet.author.id) : null, text: j.tweet.text ?? "" };
    }
  } catch {
    // fall back to syndication
  }
  if (ENV.tweetApi()) return null;
  try {
    const j = (await json(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${syndicationToken(id)}`)) as { text?: string; user?: { screen_name?: string; id_str?: string } };
    if (j?.user?.screen_name) return { id, authorHandle: j.user.screen_name, authorId: j.user.id_str ?? null, text: j.text ?? "" };
  } catch {
    // unreadable
  }
  return null;
};
