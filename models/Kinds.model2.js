module.exports = function mymodel() {
	return {
		attributes: {
			ki_id: {
				type: "integer",
				autoincrement: true,
				primary: true,
			},
			ki_name: {
				type: "string",
				defaultsTo: "",
				index: true,
			},

		},
	};
}
