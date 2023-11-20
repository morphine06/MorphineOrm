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

		},
	};
}
