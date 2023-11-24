module.exports = function mymodel() {
	return {
		attributes: {
			id: {
				type: "integer",
				autoincrement: true,
				primary: true,
			},
			speciesId: {
				model: "Species",
				alias: "species",
			},
			name: {
				type: "string",
				defaultsTo: "",
				index: true,
			},

		},
	};
}
