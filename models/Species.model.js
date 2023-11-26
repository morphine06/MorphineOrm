module.exports = function mymodel() {
	return {
		tableName: "Species2",
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

		},
	};
};
