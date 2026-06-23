import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin', 'vietnamese'], variable: '--font-inter' })
const jbm = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jbm' })

export const metadata: Metadata = {
  title: {
    default: 'Taikhoantenhat',
    template: '%s · Taikhoantenhat',
  },
  applicationName: 'Taikhoantenhat',
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
}

export const viewport: Viewport = {
  themeColor: '#ffc200',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${inter.variable} ${jbm.variable}`} suppressHydrationWarning>
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js?57" async />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){function d(){var w=window.Telegram&&window.Telegram.WebApp;if(!w)return false;w.ready();w.expand();try{if(typeof w.disableVerticalSwipes==='function')w.disableVerticalSwipes();}catch(e){}try{if(typeof w.postEvent==='function')w.postEvent('web_app_setup_swipe_behavior',{allow_vertical_swipe:false});}catch(e){}try{if(window.TelegramWebviewProxy)window.TelegramWebviewProxy.postEvent('web_app_setup_swipe_behavior',JSON.stringify({allow_vertical_swipe:false}));}catch(e){}return true;}if(!d()){var n=0,t=setInterval(function(){if(d()||++n>200)clearInterval(t);},25);}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
