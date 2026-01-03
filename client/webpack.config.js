const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const CopyPlugin = require('copy-webpack-plugin')
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin')
const { CleanWebpackPlugin } = require('clean-webpack-plugin')

module.exports = (env, argv) => {
    const isDevelopment = argv.mode === 'development'

    return {
        target: 'web',
        mode: argv.mode || 'development',
        entry: path.resolve(__dirname, 'src/index.ts'),

        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: '[name].[contenthash].js',
            publicPath: isDevelopment ? '/' : './',
            clean: true,
        },

        devtool: isDevelopment ? 'eval-source-map' : 'source-map',

        devServer: {
            static: {
                directory: path.join(__dirname, 'src'),
                publicPath: '/',
            },
            hot: true,
            historyApiFallback: true,
            compress: true,
            // Allow overriding dev server port with CLIENT_PORT env var. Default to 3001 to avoid
            // conflicting with the backend API running on port 3000 during development.
            port: process.env.CLIENT_PORT
                ? parseInt(process.env.CLIENT_PORT, 10)
                : 3001,
            client: {
                overlay: true,
            },
            // Add proper MIME type handling
            devMiddleware: {
                mimeTypes: {
                    css: 'text/css',
                },
            },
        },

        resolve: {
            extensions: ['.ts', '.tsx', '.js'],
        },

        module: {
            rules: [
                // TypeScript handling
                {
                    test: /\.tsx?$/,
                    use: {
                        loader: 'ts-loader',
                        options: {
                            transpileOnly: true,
                        },
                    },
                    exclude: /node_modules/,
                },

                // CSS handling - Simplified configuration
                {
                    test: /\.css$/,
                    use: ['style-loader', 'css-loader'],
                },

                // Asset handling
                {
                    test: /\.(png|svg|jpg|jpeg|gif)$/i,
                    type: 'asset',
                    parser: {
                        dataUrlCondition: {
                            maxSize: 8 * 1024,
                        },
                    },
                },
            ],
        },

        plugins: [
            new CleanWebpackPlugin(),

            new HtmlWebpackPlugin({
                template: path.resolve(__dirname, 'src/assets/index.html'),
                inject: true,
            }),

            new CopyPlugin({
                patterns: [
                    {
                        from: path.resolve(__dirname, 'src/assets/styles'),
                        to: path.resolve(__dirname, 'assets/styles'),
                    },
                ],
            }),

            new ForkTsCheckerWebpackPlugin({
                typescript: {
                    configFile: path.resolve(__dirname, './tsconfig.json'),
                },
            }),
        ],
    }
}
