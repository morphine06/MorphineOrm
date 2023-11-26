module.exports = function mymodel() {
	return {
		tableName: "Breeds2",
		attributes: {
			id: {
				type: "integer",
				autoincrement: true,
				primary: true,
			},
			speciesId: {
				model: "Species",
				alias: "species",
				onDelete: "RESTRICT", // RESTRICT, CASCADE, SET NULL,
				onUpdate: "RESTRICT", // RESTRICT, CASCADE, SET NULL,
			},
			name: {
				type: "string",
				defaultsTo: "",
				index: true,
			},

		},
	};
};
