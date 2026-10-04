/** Site identity. */
export const SITE = {
  name: "KUDOS",
  ticker: "$KUDOS",
  hook: "Launch a coin for anyone on X.",
  description: "90% of its creator fees go to that account. They claim by posting one tweet. The other 10% buys back and burns $KUDOS.",
  port: 3970,
  xHandle: process.env.NEXT_PUBLIC_X_HANDLE?.trim().replace(/^@/, "") || "kudoslaunch",
  url: process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3970",
} as const;
