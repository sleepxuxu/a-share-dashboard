import { createBrowserRouter, Navigate } from 'react-router'
import App from './App'
import { DashboardPage } from './pages/DashboardPage'
import { SettingsPage } from './pages/SettingsPage'
import { MarketPage } from './pages/MarketPage'
export const router=createBrowserRouter([{element:<App/>,children:[{path:'/',element:<DashboardPage/>},{path:'/market',element:<MarketPage/>},{path:'/settings',element:<SettingsPage/>},{path:'*',element:<Navigate to="/" replace/>}]}])
