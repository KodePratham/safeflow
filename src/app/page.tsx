import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      {/* Header */}
      <header className="border-b-2 border-gray-800 py-4 px-6">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <h1 className="text-xl text-orange-500 uppercase tracking-widest">SafeFlow</h1>
          <nav className="flex gap-6">
            <Link href="/admin" className="text-gray-400 hover:text-orange-500 transition-none uppercase text-sm tracking-wider">
              Create
            </Link>
            <Link href="/verify" className="text-gray-400 hover:text-orange-500 transition-none uppercase text-sm tracking-wider">
              Claim
            </Link>
          </nav>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-xl text-center">
          <h2 className="text-4xl text-white mb-6 uppercase tracking-wider leading-tight">
            Programmable<br/><span className="text-orange-500">Payment Streams</span>
          </h2>
          <p className="text-lg text-gray-400 mb-8 font-mono">
            Create SafeFlows to stream USDCx payments on Stacks. 
            Bridge USDC from Ethereum, set custom drip rates, and let recipients claim anytime.
          </p>
          
          <div className="flex gap-4 justify-center">
            <Link href="/admin" className="btn-primary">
              Create SafeFlow
            </Link>
            <Link href="/verify" className="btn-secondary">
              View & Claim
            </Link>
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            <div className="p-6 border-2 border-gray-800 hover:border-orange-500 transition-none">
              <h3 className="text-orange-500 mb-2 text-sm">01 / BRIDGE</h3>
              <p className="text-xs text-gray-400 uppercase leading-relaxed">
                Convert USDC from Ethereum to USDCx on Stacks via Circle xReserve.
              </p>
            </div>
            <div className="p-6 border-2 border-gray-800 hover:border-orange-500 transition-none">
              <h3 className="text-orange-500 mb-2 text-sm">02 / STREAM</h3>
              <p className="text-xs text-gray-400 uppercase leading-relaxed">
                Set daily or monthly drip rates. Recipients claim when ready.
              </p>
            </div>
            <div className="p-6 border-2 border-gray-800 hover:border-orange-500 transition-none">
              <h3 className="text-orange-500 mb-2 text-sm">03 / CONTROL</h3>
              <p className="text-xs text-gray-400 uppercase leading-relaxed">
                Freeze, resume, or cancel streams. Remaining funds return to you.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t-2 border-gray-800 py-6 px-6">
        <div className="max-w-4xl mx-auto text-center text-xs text-gray-600 uppercase tracking-widest">
          <p>SafeFlow — Programmable USDCx Payment Streams on Stacks</p>
        </div>
      </footer>
    </div>
  );
}
