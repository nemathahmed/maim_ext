const path = require("path");
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
    entry: {
        popup: "./src/popup.jsx",
        sidepanel: "./src/sidepanel.jsx",
        background: "./src/background.js",
        content: "./src/content.js",
    },
    output: {
        filename: "[name].js",
        path: path.resolve(__dirname, "dist")
    },
    module: {
        rules: [
            {
                test: /\.jsx?$/,
                exclude: /node_modules/,
                use: {
                    loader: "babel-loader",
                    options: {
                        presets: ["@babel/preset-react"]
                    }
                }
            },
            {
                test: /\.(ts|tsx)$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: [
                            '@babel/preset-env',
                            ['@babel/preset-react', { runtime: 'automatic' }],
                            '@babel/preset-typescript'
                        ]
                    }
                }
            }
        ]
    },
    resolve: {
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        alias: {
            '@': path.resolve(__dirname, '../workflow-chat-buddy/src'),
            'react': path.resolve(__dirname, './node_modules/react'),
            'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
        },
    },
    mode: 'development',
    devtool: 'inline-source-map',
    plugins: [
        new CopyPlugin({
            patterns: [
                { 
                    from: 'node_modules/rrweb/dist/rrweb.min.js',
                    to: '[name][ext]'
                },
                {
                    from: 'node_modules/html2canvas/dist/html2canvas.min.js',
                    to: '[name][ext]'
                }
            ],
        }),
    ],
};