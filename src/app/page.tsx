import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-200 py-4 px-6">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold text-orange-500">SafeFlow</h1>
          <nav className="flex gap-6">
            <Link href="/admin" className="text-gray-600 hover:text-orange-500 transition-colors">
              Create
            </Link>
            <Link href="/verify" className="text-gray-600 hover:text-orange-500 transition-colors">
              Claim
            </Link>
          </nav>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-xl text-center">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Programmable Payment Streams
          </h2>
          <p className="text-lg text-gray-600 mb-8">
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

          <div className="mt-12 grid grid-cols-3 gap-6 text-left">
            <div className="p-4 border border-gray-200 rounded-lg">
              <h3 className="font-bold text-gray-900 mb-2">🌉 Bridge USDC</h3>
              <p className="text-sm text-gray-600">
                Convert USDC from Ethereum to USDCx on Stacks via Circle xReserve.
              </p>
            </div>
            <div className="p-4 border border-gray-200 rounded-lg">
              <h3 className="font-bold text-gray-900 mb-2">💧 Stream Payments</h3>
              <p className="text-sm text-gray-600">
                Set daily or monthly drip rates. Recipients claim when ready.
              </p>
            </div>
            <div className="p-4 border border-gray-200 rounded-lg">
              <h3 className="font-bold text-gray-900 mb-2">🔒 Full Control</h3>
              <p className="text-sm text-gray-600">
                Freeze, resume, or cancel streams. Remaining funds return to you.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 py-6 px-6">
        <div className="max-w-4xl mx-auto text-center text-sm text-gray-500">
          <p>SafeFlow — Programmable USDCx Payment Streams on Stacks</p>
        </div>
      </footer>
    </div>
  );
}
