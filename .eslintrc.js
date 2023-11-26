module.exports = {
	"env": {
		"browser": false,
		"commonjs": true,
		"es2021": true,
		"node": true,
	},
	"extends": "eslint:recommended",
	"overrides": [
		{
			"env": {
				"node": true,
			},
			"files": [
				".eslintrc.{js,cjs}",
			],
			"parserOptions": {
				"sourceType": "script",
			},
		},
	],
	"parserOptions": {
		"ecmaVersion": "latest",
	},
	"rules": {
		"indent": [
			"error",
			"tab",
		],
		"linebreak-style": [
			"error",
			"unix",
		],
		"quotes": [
			"error",
			"double",
		],
		"semi": [
			"error",
			"always",
		],
		"comma-dangle": [
			"error",
			"always-multiline",
		],
		"default-case": [
			"off",
		],
		"no-unused-vars": [
			"error",
			{
				"args": "none",
			},
		],
	},
};
