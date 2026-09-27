"use server";

export async function verifyTurnstileToken(token?: string) {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey || secretKey === "disabled" || process.env.OFFLINE_MODE === "true") {
    // Graceful bypass for air-gapped / offline LAN venue deployments
    return { success: true };
  }

  if (!token || typeof token !== "string") {
    return { success: false, error: "Captcha verification token is required" };
  }

  try {
    const formData = new FormData();
    formData.append("secret", secretKey.trim());
    formData.append("response", token);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      console.error(`[Turnstile] Cloudflare siteverify endpoint returned status: ${res.status}`);
      return { success: false, error: "Failed to connect to verification server" };
    }

    const data = await res.json();
    if (data.success) {
      return { success: true };
    } else {
      console.error("[Turnstile] Verification failed:", data);
      return { success: false, error: "Security check failed. Please try again." };
    }
  } catch (error) {
    console.error("[Turnstile] Verification error:", error);
    return { success: false, error: "An error occurred during security verification" };
  }
}

