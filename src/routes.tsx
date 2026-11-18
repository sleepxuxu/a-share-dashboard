import { createBrowserRouter, Navigate } from 'react-router'
import App from './App'
import { DashboardPage } from './pages/DashboardPage'
import { SettingsPage } from './pages/SettingsPage'
import { MarketPage } from './pages/MarketPage'
import { AuctionPage } from './pages/AuctionPage'
import { AuctionBacktestPage } from './pages/AuctionBacktestPage'
import { AuctionSelectionPage } from './pages/AuctionSelectionPage'
export const router=createBrowserRouter([{element:<App/>,children:[{path:'/',element:<DashboardPage/>},{path:'/market',element:<MarketPage/>},{path:'/auction',element:<AuctionPage/>},{path:'/auction/backtest',element:<AuctionSelectionPage/>},{path:'/auction/strategy-backtest',element:<AuctionBacktestPage/>},{path:'/settings',element:<SettingsPage/>},{path:'*',element:<Navigate to="/" replace/>}]}])
