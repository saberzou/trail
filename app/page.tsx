export default function Home() {
  return (
    <main className="min-h-screen bg-[#f7f7f2] px-6 py-10 text-[#171814]">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col justify-center">
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.18em] text-[#5f6f52]">
          Trail Phase 0
        </p>
        <h1 className="max-w-3xl text-5xl font-semibold leading-tight">
          A spatial canvas for web research trails.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-[#4c5145]">
          The scaffold is ready. The canvas spike lives at{" "}
          <a className="font-medium underline" href="/canvas">
            /canvas
          </a>
          .
        </p>
      </section>
    </main>
  );
}
