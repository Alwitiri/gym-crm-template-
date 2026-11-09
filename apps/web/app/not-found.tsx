import Link from "next/link";
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <h1 className="text-4xl">Page not found</h1>
        <p className="mt-2 text-ink-2">The link may be old, or you may not have access to it.</p>
        <Link href="/" className="mt-6 inline-block underline">Go to the dashboard</Link>
      </div>
    </main>
  );
}
