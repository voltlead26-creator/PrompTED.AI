import Link from "next/link";

export default function NotFound() {
  return (
    <main
      style={{
        display: "grid",
        minHeight: "70vh",
        placeItems: "center",
        padding: "32px 20px",
        textAlign: "center",
      }}
    >
      <section>
        <h1>That page is not available</h1>
        <p>The link may be old, or this workspace may belong to another account.</p>
        <Link href="/home">Return home</Link>
      </section>
    </main>
  );
}
