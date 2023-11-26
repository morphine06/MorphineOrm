module.exports = function mymodel() {
	return {
		tableName: "Animals2",
		attributes: {
			id: {
				type: "integer",
				autoincrement: true,
				primary: true,
			},
			name: {
				type: "string",
				defaultsTo: "",
				index: true,
				validator: {
					fn: "isLength",
					args: { min: 10, max: 255 },
				},
			},
			birth: {
				type: "date",
				defaultsTo: "0000-00-00",
				notnull: false,
				index: true,
			},
			breedId: {
				model: "Breeds",
				alias: "breed",
				onDelete: "RESTRICT", // RESTRICT, CASCADE, SET NULL,
				onUpdate: "RESTRICT", // RESTRICT, CASCADE, SET NULL,
			},
			// size: {
			// 	type: "string",
			// 	defaultsTo: "",
			// 	index: true,
			// },
			// attitude: {
			// 	type: "string",
			// 	defaultsTo: "",
			// 	index: true,
			// },
			// sex: {
			// 	type: "string",
			// 	defaultsTo: "",
			// 	index: true,
			// },
			// cote: {
			// 	type: "string",
			// 	defaultsTo: "",
			// 	index: true,
			// },
			// biter: {
			// 	type: "integer",
			// 	defaultsTo: 0,
			// },
			// neutering: {
			// 	type: "integer",
			// 	defaultsTo: 0,
			// },
			// chip: {
			// 	type: "integer",
			// 	defaultsTo: 0,
			// 	index: true,
			// },
			// therapy: {
			// 	type: "string",
			// 	defaultsTo: "",
			// 	index: true,
			// },
			// pathologies: {
			// 	type: "string",
			// 	defaultsTo: "",
			// 	index: true,
			// },
			// onhome: {
			// 	type: "tinyint",
			// 	defaultsTo: 0,
			// },
		},
	};
};
