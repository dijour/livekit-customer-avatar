import localFont from 'next/font/local'

export const amazonEmberDisplay = localFont({
  src: [
    {
      path: '../public/fonts/AmazonEmberDisplay_Rg.ttf',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../public/fonts/AmazonEmberDisplay_Lt.ttf',
      weight: '300',
      style: 'normal',
    },
    {
      path: '../public/fonts/AmazonEmberDisplay_Md.ttf',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../public/fonts/AmazonEmberDisplay_Bd.ttf',
      weight: '700',
      style: 'normal',
    },
    {
      path: '../public/fonts/AmazonEmberDisplay_He.ttf',
      weight: '800',
      style: 'normal',
    },
  ],
  variable: '--font-amazon-ember'
})
