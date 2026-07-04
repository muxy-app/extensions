export async function toast(body, variant = "info") {
    await muxy.toast({ body, variant }).catch(() => undefined);
}
