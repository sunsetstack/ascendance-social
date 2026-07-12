import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default [
	// Global ignores
	{
		ignores: ["**/node_modules/**", "**/dist/**", "**/__tests__/**", "**/build/**"],
	},
	// Backend (Node)
	{
		files: ["backend/src/**/*.ts"],
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: "module",
			globals: globals.node,
			parser: tseslint.parser,
			parserOptions: {
				project: path.resolve(__dirname, "./backend/tsconfig.json"),
			},
		},
		plugins: {
			"@typescript-eslint": tseslint.plugin,
		},
		rules: {
			"@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
		},
	},
	// Backend application layer import boundaries
	{
		files: ["backend/src/application/**/*.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "../repositories/post.repository",
							message: "Use PostReadRepository or PostWriteRepository instead",
						},
						{
							name: "../../repositories/post.repository",
							message: "Use PostReadRepository or PostWriteRepository instead",
						},
						{
							name: "../../../repositories/post.repository",
							message: "Use PostReadRepository or PostWriteRepository instead",
						},
						{
							name: "../../../../repositories/post.repository",
							message: "Use PostReadRepository or PostWriteRepository instead",
						},
						{
							name: "../repositories/user.repository",
							message: "Use UserReadRepository or UserWriteRepository instead",
						},
						{
							name: "../../repositories/user.repository",
							message: "Use UserReadRepository or UserWriteRepository instead",
						},
						{
							name: "../../../repositories/user.repository",
							message: "Use UserReadRepository or UserWriteRepository instead",
						},
						{
							name: "../../../../repositories/user.repository",
							message: "Use UserReadRepository or UserWriteRepository instead",
						},
					],
				},
			],
		},
	},
	// API Gateway (Node)
	{
		files: ["api-gateway/src/**/*.ts"],
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: "module",
			globals: globals.node,
			parser: tseslint.parser,
			parserOptions: {
				project: path.resolve(__dirname, "./api-gateway/tsconfig.json"),
			},
		},
		plugins: {
			"@typescript-eslint": tseslint.plugin,
		},
		rules: {
			"@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
		},
	},
	// Frontend (React)
	{
		files: ["frontend/src/**/*.{ts,tsx}"],
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: "module",
			globals: globals.browser,
			parser: tseslint.parser,
			parserOptions: {
				project: path.resolve(__dirname, "./frontend/tsconfig.app.json"),
			},
		},
		plugins: {
			"@typescript-eslint": tseslint.plugin,
			react,
			"react-hooks": reactHooks,
		},
		rules: {
			"@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
			"react/react-in-jsx-scope": "off",
		},
		settings: {
			react: { version: "detect" },
		},
	},
];
