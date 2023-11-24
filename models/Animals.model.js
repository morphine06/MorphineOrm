module.exports = function mymodel() {
	return {
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
			},
			birth: {
				type: "date",
				defaultsTo: "0000-00-00",
				index: true,
			},
			kindId: {
				model: "Breeds",
				alias: "breed",
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
}
