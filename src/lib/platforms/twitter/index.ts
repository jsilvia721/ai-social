// Twitter/X API client
// Uses OAuth 2.0 with PKCE

export async function publishTweet(
  accessToken: string,
  content: string
): Promise<{ id: string; url: string }> {
  const res = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: content }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(`Twitter publish failed: ${JSON.stringify(error)}`);
  }

  const data = await res.json();
  return {
    id: data.data.id,
    url: `https://twitter.com/i/web/status/${data.data.id}`,
  };
}
