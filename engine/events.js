// ========== HISTORICAL EVENTS DATABASE ==========
const HISTORICAL_EVENTS = {
    oil: [
        {
            id: 'kuwait_1990',
            name: 'Kuwait Invasion',
            date: '1990-08-02',
            category: 'Geopolitical',
            priceBefore: 21.54,
            pricePeak: 41.15,
            peakDays: 60,
            priceAfter90d: 33.50,
            priceRecovery: 21.00,
            recoveryDays: 210,
            pctToPeak: 91.0,
            supplyLost: 4.3,
            supplyPctGlobal: 6.4,
            duration: 210,
            description: 'Iraq invaded Kuwait, removing ~4.3M bbl/d from market. Oil doubled in 60 days. Coalition forces liberated Kuwait Feb 1991.',
            dailyPrices: [21.54,22.61,24.54,26.23,27.31,27.97,28.05,28.76,29.12,30.17,31.33,32.64,33.78,34.42,35.15,33.91,34.71,35.42,36.11,35.78,34.50,35.89,37.12,38.45,39.18,38.64,37.92,38.50,39.76,40.10,40.95,41.15,40.78,39.45,38.12,37.86,36.98,36.14,35.50,34.89,34.12,33.87,33.50,33.12,32.75,32.40,31.90,31.50,31.18,30.85,30.50,30.12,29.75,29.40,29.10,28.85,28.50,28.10,27.65,27.30]
        },
        {
            id: 'abqaiq_2019',
            name: 'Abqaiq/Khurais Attack',
            date: '2019-09-14',
            category: 'Supply Shock',
            priceBefore: 54.85,
            pricePeak: 62.90,
            peakDays: 1,
            priceAfter90d: 55.17,
            priceRecovery: 54.85,
            recoveryDays: 14,
            pctToPeak: 14.7,
            supplyLost: 5.7,
            supplyPctGlobal: 5.7,
            duration: 14,
            description: 'Drone/missile attack on Saudi Aramco Abqaiq. Removed 5.7M bbl/d (largest single disruption ever). Prices spiked 15% but recovered in 2 weeks as Saudi rapidly repaired.',
            dailyPrices: [54.85,62.90,62.40,59.34,58.64,58.11,57.50,56.87,56.30,55.90,55.60,55.40,55.20,55.17]
        },
        {
            id: 'covid_2020',
            name: 'COVID-19 Crash',
            date: '2020-03-06',
            category: 'Demand Shock',
            priceBefore: 46.78,
            pricePeak: -37.63,
            peakDays: 45,
            priceAfter90d: 40.46,
            priceRecovery: 46.78,
            recoveryDays: 240,
            pctToPeak: -180.4,
            supplyLost: -9.0,
            supplyPctGlobal: -9.0,
            duration: 240,
            description: 'OPEC+ price war + COVID lockdowns crashed demand by ~29M bbl/d. WTI went negative on Apr 20 (storage full). Historic demand destruction event.',
            dailyPrices: [46.78,45.90,41.28,34.36,31.73,30.10,28.70,27.34,24.01,22.43,20.48,19.84,20.31,23.16,24.74,23.63,20.09,19.46,18.27,20.48,25.09,25.78,26.42,24.56,23.99,22.76,21.04,20.29,20.11,19.87,18.84,18.27,16.50,14.10,11.57,-37.63,10.01,15.06,16.50,18.84,19.78,20.39,24.74,26.42,29.43,33.22,34.35,36.81,38.94,40.46,41.65,39.27,40.60,41.12,39.77,40.46]
        },
        {
            id: 'russia_2022',
            name: 'Russia-Ukraine Invasion',
            date: '2022-02-24',
            category: 'Geopolitical',
            priceBefore: 92.10,
            pricePeak: 130.50,
            peakDays: 12,
            priceAfter90d: 109.77,
            priceRecovery: 92.10,
            recoveryDays: 120,
            pctToPeak: 41.7,
            supplyLost: 3.0,
            supplyPctGlobal: 3.0,
            duration: 120,
            description: 'Russia invaded Ukraine. Sanctions on Russian oil threatened ~3M bbl/d. WTI spiked 42% in 12 days. Prices stayed elevated for months due to supply uncertainty.',
            dailyPrices: [92.10,93.54,95.72,99.10,103.41,107.67,110.60,115.68,119.40,123.70,126.51,130.50,128.26,124.30,119.50,116.80,112.34,109.33,108.26,106.95,104.27,103.41,105.96,108.70,109.50,107.25,106.40,104.76,103.28,101.56,99.76,98.52,99.10,100.40,101.20,102.78,104.89,106.10,108.36,109.77,108.43,107.50,105.90,104.12,102.60,101.33,100.10,99.25,98.50,97.40,96.80,95.70,94.50,93.80,93.10,92.50,92.10]
        },
        {
            id: 'libya_2011',
            name: 'Libya Civil War',
            date: '2011-02-15',
            category: 'Geopolitical',
            priceBefore: 84.32,
            pricePeak: 113.93,
            peakDays: 75,
            priceAfter90d: 100.30,
            priceRecovery: 84.32,
            recoveryDays: 365,
            pctToPeak: 35.1,
            supplyLost: 1.6,
            supplyPctGlobal: 1.8,
            duration: 365,
            description: 'Libyan civil war removed ~1.6M bbl/d of light sweet crude. Arab Spring contagion fears amplified the move. Oil stayed above $85 for most of 2011.',
            dailyPrices: [84.32,86.20,89.71,93.57,97.88,98.10,96.97,99.63,102.23,104.42,105.44,104.42,103.98,106.72,108.47,109.77,108.26,105.75,104.60,106.40,108.90,111.30,112.79,113.93,112.50,110.80,109.40,108.70,107.50,106.80,105.50,104.20,103.40,102.70,101.80,101.20,100.80,100.30]
        },
        {
            id: 'oil_crash_2008',
            name: '2008 Oil Spike & Crash',
            date: '2008-01-02',
            category: 'Bubble/Crash',
            priceBefore: 99.62,
            pricePeak: 145.31,
            peakDays: 180,
            priceAfter90d: 67.81,
            priceRecovery: 99.62,
            recoveryDays: 730,
            pctToPeak: 45.9,
            supplyLost: 0,
            supplyPctGlobal: 0,
            duration: 365,
            description: 'Oil spiked to $147 on speculation + China demand, then crashed to $32 during the financial crisis. The entire move (up AND down) took ~12 months.',
            dailyPrices: [99.62,100.10,104.52,109.71,105.48,110.21,117.48,119.93,125.96,132.32,134.56,138.54,139.64,140.21,143.67,145.31,141.37,127.35,115.46,109.71,104.08,96.37,86.59,78.68,73.85,67.81,62.73,60.77,55.36,49.28,44.60,40.81,36.22,33.87,32.40]
        },
        {
            id: 'oil_crash_2014',
            name: '2014-2016 Oil Crash',
            date: '2014-06-20',
            category: 'Supply Glut',
            priceBefore: 107.26,
            pricePeak: 26.21,
            peakDays: 570,
            priceAfter90d: 82.70,
            priceRecovery: 107.26,
            recoveryDays: -1,
            pctToPeak: -75.6,
            supplyLost: -3.0,
            supplyPctGlobal: -3.0,
            duration: 570,
            description: 'US shale revolution flooded the market with ~4M bbl/d of new supply. OPEC refused to cut. Oil fell 76% over 18 months. Never fully recovered pre-crash highs.',
            dailyPrices: [107.26,105.37,103.59,98.17,93.17,90.43,84.44,77.75,73.47,66.15,59.29,53.27,52.69,48.24,44.45,47.60,48.65,53.05,59.63,60.42,57.52,49.20,46.65,44.66,48.56,47.15,45.68,42.53,40.45,38.22,37.04,35.92,33.62,31.90,29.64,28.36,26.55,26.21,28.46,30.32,32.78,35.50,37.40,39.44,41.08,43.73,47.72]
        }
    ],

    crypto: [
        {
            id: 'btc_2017',
            name: '2017 BTC Bull Run',
            date: '2017-01-01',
            category: 'Bull Cycle',
            priceBefore: 998,
            pricePeak: 19783,
            peakDays: 350,
            pctToPeak: 1882,
            description: 'ICO mania drove BTC from $1K to $20K in 12 months. Retail FOMO, no institutional access. Ended with futures launch.',
            monthlyPrices: [998,1043,1215,1348,2300,2700,2875,4360,3674,4395,6457,8041,10975,13860,16500,19783,13412,8342,6914,6390]
        },
        {
            id: 'btc_2021',
            name: '2021 BTC Bull Run',
            date: '2021-01-01',
            category: 'Bull Cycle',
            priceBefore: 29374,
            pricePeak: 68789,
            peakDays: 315,
            pctToPeak: 134,
            description: 'Institutional adoption (MicroStrategy, Tesla), DeFi summer carryover, NFT boom. Double-top pattern with $64K April, $69K November.',
            monthlyPrices: [29374,33114,45137,58800,57684,35804,33572,38150,41512,47100,43790,61300,63500,57000,68789,46211,37708]
        },
        {
            id: 'ftx_2022',
            name: 'FTX Collapse',
            date: '2022-11-06',
            category: 'Black Swan',
            priceBefore: 21300,
            pricePeak: 15476,
            peakDays: 14,
            pctToPeak: -27.3,
            description: 'FTX exchange collapsed, wiping out ~$8B in customer funds. Contagion fears hit all crypto. BTC fell 27% in 2 weeks.',
            dailyPrices: [21300,20800,20200,20100,19400,18540,17167,16530,16800,16500,16200,16100,15700,15476,16100,16400,16550,16700,16800,16600,16800]
        },
        {
            id: 'etf_2024',
            name: 'BTC ETF Approval',
            date: '2024-01-10',
            category: 'Institutional',
            priceBefore: 46000,
            pricePeak: 73750,
            peakDays: 60,
            pctToPeak: 60.3,
            description: 'SEC approved 11 spot Bitcoin ETFs. $12B+ inflows in first 3 months. Institutional access opened. Historic moment for crypto legitimization.',
            dailyPrices: [46000,46500,47800,42500,43100,44200,43800,45300,48900,51800,52100,51200,52900,57000,61200,63100,62500,64800,67500,69200,71700,73750,69100,63400,65800,67900,69500,70100,68500,66800]
        },
        {
            id: 'terra_2022',
            name: 'Terra/LUNA Crash',
            date: '2022-05-07',
            category: 'Black Swan',
            priceBefore: 35500,
            pricePeak: 26700,
            peakDays: 14,
            pctToPeak: -24.8,
            description: 'UST algorithmic stablecoin depegged, LUNA went from $80 to $0. Contagion spread across DeFi. BTC fell 25% as leveraged positions unwound.',
            dailyPrices: [35500,34700,33800,33200,31000,29300,28200,27100,28900,29500,28700,27800,27200,26700,28100,29200,30100,29800,29400,28800,29100]
        },
        {
            id: 'covid_btc_2020',
            name: 'COVID BTC Crash',
            date: '2020-03-08',
            category: 'Macro Crash',
            priceBefore: 9100,
            pricePeak: 3858,
            peakDays: 5,
            pctToPeak: -57.6,
            description: 'Global pandemic panic caused BTC to crash 58% in 5 days. Massive leveraged liquidations. Fastest and deepest BTC crash ever. Full recovery took 6 months.',
            dailyPrices: [9100,8900,7950,7650,5700,5000,4800,3858,4900,5300,5600,5900,6200,6500,6700,6400,6600,6800,7100,7300]
        }
    ],

    // Macro reference data
    macro: {
        fedFundsRate: {
            label: 'Fed Funds Rate (%)',
            data: {'2020-01':1.75,'2020-03':0.25,'2020-12':0.25,'2021-12':0.25,'2022-03':0.50,'2022-06':1.75,'2022-09':3.25,'2022-12':4.50,'2023-03':5.00,'2023-07':5.50,'2023-12':5.50,'2024-09':5.00,'2024-12':4.50}
        },
        dxy: {
            label: 'US Dollar Index',
            data: {'2020-01':97.4,'2020-03':102.8,'2020-06':97.3,'2020-12':89.9,'2021-06':92.2,'2021-12':96.0,'2022-06':104.7,'2022-09':114.1,'2022-12':103.5,'2023-06':103.4,'2023-12':101.4,'2024-06':105.5,'2024-12':108.0}
        }
    }
};

// ========== VOLATILITY DATABASE ==========
// Annualized historical volatilities for key assets
const VOLATILITY_DB = {
    'WTI':  { vol30d: 0.35, vol90d: 0.38, vol1y: 0.40, longTermAvg: 0.35 },
    'BTC':  { vol30d: 0.55, vol90d: 0.60, vol1y: 0.65, longTermAvg: 0.70 },
    'POL':  { vol30d: 0.80, vol90d: 0.85, vol1y: 0.90, longTermAvg: 0.95 },
    'RNDR': { vol30d: 0.90, vol90d: 0.95, vol1y: 1.00, longTermAvg: 1.10 },
    'LINK': { vol30d: 0.70, vol90d: 0.75, vol1y: 0.80, longTermAvg: 0.85 },
    'KAS':  { vol30d: 1.00, vol90d: 1.10, vol1y: 1.20, longTermAvg: 1.30 },
    'UCO':  { vol30d: 0.65, vol90d: 0.70, vol1y: 0.75, longTermAvg: 0.70 },
    'GUSH': { vol30d: 0.70, vol90d: 0.75, vol1y: 0.80, longTermAvg: 0.75 },
    'XLE':  { vol30d: 0.25, vol90d: 0.28, vol1y: 0.30, longTermAvg: 0.28 },
    'OXY':  { vol30d: 0.40, vol90d: 0.45, vol1y: 0.50, longTermAvg: 0.48 },
    'XOM':  { vol30d: 0.22, vol90d: 0.25, vol1y: 0.28, longTermAvg: 0.25 },
    'SPY':  { vol30d: 0.15, vol90d: 0.17, vol1y: 0.18, longTermAvg: 0.16 },
    'GLD':  { vol30d: 0.14, vol90d: 0.15, vol1y: 0.16, longTermAvg: 0.15 }
};

// ========== CORRELATION REFERENCE DATA ==========
// Approximate historical correlations (long-term averages)
const CORRELATION_REF = {
    names: ['WTI', 'BTC', 'SPY', 'DXY', 'GLD', 'XLE', 'POL'],
    matrix: {
        WTI: { WTI: 1.00, BTC: 0.25, SPY: 0.35, DXY: -0.45, GLD: 0.20, XLE: 0.85, POL: 0.15 },
        BTC: { WTI: 0.25, BTC: 1.00, SPY: 0.45, DXY: -0.35, GLD: 0.10, XLE: 0.20, POL: 0.75 },
        SPY: { WTI: 0.35, BTC: 0.45, SPY: 1.00, DXY: -0.20, GLD: -0.05, XLE: 0.65, POL: 0.40 },
        DXY: { WTI: -0.45, BTC: -0.35, DXY: 1.00, SPY: -0.20, GLD: -0.40, XLE: -0.30, POL: -0.30 },
        GLD: { WTI: 0.20, BTC: 0.10, SPY: -0.05, DXY: -0.40, GLD: 1.00, XLE: 0.15, POL: 0.05 },
        XLE: { WTI: 0.85, BTC: 0.20, SPY: 0.65, DXY: -0.30, GLD: 0.15, XLE: 1.00, POL: 0.15 },
        POL: { WTI: 0.15, BTC: 0.75, SPY: 0.40, DXY: -0.30, GLD: 0.05, XLE: 0.15, POL: 1.00 }
    }
};

