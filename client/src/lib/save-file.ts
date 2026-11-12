// Hand a generated file (CSV, PDF, backup, printable page) to the user.
//  - iPhone app: write it to the app's cache and open the share sheet
//    (Save to Files, AirDrop, WhatsApp, Mail, Print...).
//  - Browser: a normal download.

export function isNativeApp(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const cancelled = (err: unknown) => /cancel|abort/i.test(String((err as any)?.message ?? (err as any)?.name ?? err));

function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  if (isNativeApp()) {
    try {
      const [{ Filesystem, Directory }, { Share }] = await Promise.all([
        import("@capacitor/filesystem"),
        import("@capacitor/share"),
      ]);
      const written = await Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: Directory.Cache });
      await Share.share({ title: filename, files: [written.uri] });
      return;
    } catch (err) {
      if (cancelled(err)) return;
      console.warn("Native share failed, trying the web share sheet", err);
    }
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (err) {
      if (cancelled(err)) return;
    }
  }
  download(blob, filename);
}
