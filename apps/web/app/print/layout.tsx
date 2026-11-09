import { SessionProvider } from "@/lib/session";

/** Printable pages: signed-in, but without the app's sidebar and top bar. */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <main className="mx-auto max-w-3xl px-6 py-8 print:max-w-none print:p-0">{children}</main>
    </SessionProvider>
  );
}
