module.exports = function mymodel() {
	return {
		attributes: {
			do_id: {
				type: "integer",
				autoincrement: true,
				primary: true,
			},
			do_name: {
				type: "string",
				defaultsTo: "",
				index: true,
			},
			do_birth: {
				type: "date",
				defaultsTo: "0000-00-00",
				index: true,
			},
			ki_id: {
				model: "Kinds",
				alias: "kind",
			},
			do_size: {
				type: "string",
				defaultsTo: "",
				index: true,
			},
			do_attitude: {
				type: "string",
				defaultsTo: "",
				index: true,
			},
			do_sex: {
				type: "string",
				defaultsTo: "",
				index: true,
			},
			do_cote: {
				type: "string",
				defaultsTo: "",
				index: true,
			},
			do_biter: {
				type: "integer",
				defaultsTo: 0,
			},
			do_neutering: {
				type: "integer",
				defaultsTo: 0,
			},
			do_chip: {
				type: "integer",
				defaultsTo: 0,
				index: true,
			},
			do_therapy: {
				type: "string",
				defaultsTo: "",
				index: true,
			},
			do_pathologies: {
				type: "string",
				defaultsTo: "",
				index: true,
			},
			do_onhome: {
				type: "tinyint",
				defaultsTo: 0,
			},
		},
	};
}
