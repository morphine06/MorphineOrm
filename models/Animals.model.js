module.exports = function mymodel() {
	return {
		beforeUpdate: async function (data) {
			if (data.name && data.name == "toto not allowed") {
				data.name = "toto";
			}
		},
		beforeCreate: async function (data) {
			if (data.name && data.name == "toto") {
				data.name = "toto not allowed";
			}
		},
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
			legs: {
				type: "integer",
				defaultsTo: 2,
			},
			breedId: {
				model: "Breeds",
				alias: "breed",
				onDelete: "RESTRICT", // RESTRICT, CASCADE, SET NULL,
				onUpdate: "RESTRICT", // RESTRICT, CASCADE, SET NULL,
			},
		},
		virtuals: {
			age: function () {
				return new Date().getFullYear() - new Date(this.birth).getFullYear();
			},
		},
	};
};
